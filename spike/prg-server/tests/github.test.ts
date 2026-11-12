import { describe, expect, test } from "bun:test";
import { ciFrame, githubLive, POLL, Poller, type Runner, requiredChecks } from "../server/github";
import { Review } from "../server/review";
import type { GithubLive } from "../shared/live";
import { loaded } from "./helpers";

type Run = { name: string; status: string; conclusion?: string };

const HEAD = "a".repeat(40);

const answer = (runs: Run[], head = HEAD) => ({
  data: {
    repository: {
      pullRequest: {
        state: "OPEN",
        isDraft: false,
        reviewDecision: null,
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
        headRefOid: head,
        headRefName: "abc-12-slugs",
        baseRefName: "main",
        url: "https://github.com/acme/shop/pull/12",
        body: "Try the [Vercel Preview](https://shop-git-slugs.vercel.app) first.",
        author: { __typename: "User", login: "thandi", avatarUrl: "https://avatars.githubusercontent.com/u/1" },
        latestReviews: { nodes: [{ state: "APPROVED", author: { login: "sipho", avatarUrl: null } }] },
        reviewRequests: { nodes: [{ requestedReviewer: { __typename: "Team", name: "web" } }] },
        comments: { nodes: [] },
        commits: {
          nodes: [
            {
              commit: {
                deployments: { nodes: [] },
                statusCheckRollup: {
                  contexts: {
                    nodes: runs.map(run => ({
                      __typename: "CheckRun",
                      name: run.name,
                      status: run.status,
                      conclusion: run.conclusion ?? null,
                      startedAt: "2026-11-11T10:00:00Z",
                      completedAt: run.conclusion ? "2026-11-11T10:01:05Z" : null,
                      detailsUrl: `https://github.com/acme/shop/actions/runs/1/job/${run.name}`,
                      checkSuite: { workflowRun: { workflow: { name: "ci" } } },
                    })),
                  },
                },
              },
            },
          ],
        },
      },
    },
  },
});

const running: Run[] = [
  { name: "build", status: "IN_PROGRESS" },
  { name: "lint", status: "QUEUED" },
];
const buildFailed: Run[] = [
  { name: "build", status: "COMPLETED", conclusion: "FAILURE" },
  { name: "lint", status: "IN_PROGRESS" },
];
const settled: Run[] = [
  { name: "build", status: "COMPLETED", conclusion: "FAILURE" },
  { name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
];

function rig(script: (call: number) => { stdout?: unknown; stderr?: string; code?: number }) {
  const calls: string[][] = [];
  const changes: { before: GithubLive; after: GithubLive }[] = [];
  let now = 0;
  let watching = true;
  const runner: Runner = async cmd => {
    calls.push(cmd);
    const { stdout, stderr = "", code = 0 } = script(calls.length);
    return { code, stdout: stdout === undefined ? "" : JSON.stringify(stdout), stderr };
  };
  const review = new Review(loaded(), async () => loaded());
  const poller = new Poller({
    review,
    cwd: "/nowhere",
    runner,
    now: () => now,
    watching: () => watching,
    avatars: new Map(),
    onChange: (_layer, before, after) => changes.push({ before, after }),
  });
  return {
    poller,
    calls,
    changes,
    at: (ms: number) => {
      now = ms;
      return poller.tick();
    },
    watch: (on: boolean) => {
      watching = on;
    },
  };
}

describe("the CI poller", () => {
  test("a check the trunk's rules require that nothing reported is listed as expected, as GitHub's merge box has it", async () => {
    const rules = [
      { type: "deletion" },
      { type: "required_status_checks", parameters: { required_status_checks: [{ context: "build" }, { context: "e2e-tests" }] } },
    ];
    const asked: string[] = [];
    const runner: Runner = async cmd => {
      asked.push(cmd.join(" "));
      const stdout = cmd.includes("graphql") ? answer([{ name: "build", status: "COMPLETED", conclusion: "SUCCESS" }]) : rules;
      return { code: 0, stdout: JSON.stringify(stdout), stderr: "" };
    };
    const [layer] = loaded().response.layers;
    if (!layer) {
      throw new Error("the fixture has no layer");
    }
    const required = await requiredChecks(runner, "/nowhere", "acme/shop", "release/1.x");
    expect(asked).toEqual(["gh api repos/acme/shop/rules/branches/release%2F1.x"]);
    const live = await githubLive(runner, "/nowhere", layer, new Map(), required);
    expect(live.checks.map(check => [check.name, check.bucket])).toEqual([
      ["build", "pass"],
      ["e2e-tests", "expected"],
    ]);
  });

  test("asks only while a page is open, often while checks run and rarely once they settle, and reports each change once", async () => {
    const states = [running, running, buildFailed, settled, settled];
    const r = rig(call => ({ stdout: answer(states[call - 1] ?? settled) }));

    r.watch(false);
    await r.at(0);
    expect(r.calls).toHaveLength(0);

    r.watch(true);
    await r.at(0);
    expect(r.calls).toHaveLength(1);
    expect(r.changes).toHaveLength(0);

    await r.at(POLL.running - 1);
    expect(r.calls).toHaveLength(1);
    await r.at(POLL.running);
    expect(r.calls).toHaveLength(2);
    expect(r.changes).toHaveLength(0);

    await r.at(2 * POLL.running);
    expect(r.calls).toHaveLength(3);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]?.after.checks.find(c => c.name === "build")?.bucket).toBe("fail");

    await r.at(3 * POLL.running);
    expect(r.calls).toHaveLength(4);
    expect(r.changes).toHaveLength(2);

    await r.at(3 * POLL.running + POLL.settled - 1);
    expect(r.calls).toHaveLength(4);
    r.watch(false);
    await r.at(3 * POLL.running + POLL.settled);
    expect(r.calls).toHaveLength(4);
    r.watch(true);
    await r.at(3 * POLL.running + POLL.settled);
    expect(r.calls).toHaveLength(5);
    expect(r.changes).toHaveLength(2);

    expect(r.calls.every(cmd => cmd.slice(0, 3).join(" ") === "gh api graphql")).toBe(true);
    expect(r.calls.every(cmd => !/\bmutation\b/.test(cmd.find(arg => arg.startsWith("query=")) ?? ""))).toBe(true);
  });

  test("the page's own requests share the poller's answer for ten seconds, unless it asks for a fresh one", async () => {
    const r = rig(() => ({ stdout: answer(settled) }));
    const layer = loaded().response.layers[0];
    if (!layer) {
      throw new Error("no layer");
    }
    await r.poller.get(layer);
    await r.poller.get(layer);
    expect(r.calls).toHaveLength(1);
    await r.poller.get(layer, true);
    expect(r.calls).toHaveLength(2);
  });

  test("a rate limit backs off for a quarter of an hour, other failures for a minute and then longer", async () => {
    const limited = rig(() => ({ code: 1, stderr: "gh: API rate limit exceeded for user ID 1." }));
    await limited.at(0);
    await limited.at(POLL.rateLimited - 1);
    expect(limited.calls).toHaveLength(1);
    await limited.at(POLL.rateLimited);
    expect(limited.calls).toHaveLength(2);

    const broken = rig(() => ({ code: 1, stderr: "gh: Could not resolve to a PullRequest with the number of 12." }));
    await broken.at(0);
    await broken.at(POLL.failedBase);
    expect(broken.calls).toHaveLength(2);
    await broken.at(POLL.failedBase * 2);
    expect(broken.calls).toHaveLength(2);
    await broken.at(POLL.failedBase * 3);
    expect(broken.calls).toHaveLength(3);
  });

  test("reads the head, reviewers, merge state and a preview link, and notices the branch moving past the guide", async () => {
    const r = rig(() => ({ stdout: answer(settled, "b".repeat(40)) }));
    const layer = loaded().response.layers[0];
    if (!layer) {
      throw new Error("no layer");
    }
    const live = await r.poller.get(layer);
    expect(live.pr).toMatchObject({
      moved: true,
      builtSha: HEAD,
      mergeState: "CLEAN",
      author: { login: "thandi", avatar: true },
      reviewers: [
        { login: "sipho", avatar: false, state: "approved", team: false },
        { login: "web", state: "requested", team: true },
      ],
      previews: [{ label: "Vercel Preview", url: "https://shop-git-slugs.vercel.app", from: "description" }],
    });
    expect(live.checks.map(c => [c.name, c.bucket])).toEqual([
      ["build", "fail"],
      ["lint", "pass"],
    ]);
  });

  test("the session hears once when a check fails and once when the run finishes, naming the check and its link", async () => {
    const r = rig(call => ({ stdout: answer([running, buildFailed, settled][call - 1] ?? settled) }));
    const layer = loaded().response.layers[0];
    if (!layer) {
      throw new Error("no layer");
    }
    const first = await r.poller.get(layer, true);
    const second = await r.poller.get(layer, true);
    const third = await r.poller.get(layer, true);

    expect(ciFrame(layer, false, first, first)).toBeNull();
    expect(ciFrame(layer, false, first, second)).toBe(
      [
        "[review page] a check failed on #12 (acme/shop)",
        '  failed: "build" (ci) https://github.com/acme/shop/actions/runs/1/job/build',
        "  all checks: https://github.com/acme/shop/pull/12/checks",
      ].join("\n"),
    );
    expect(ciFrame(layer, false, second, third)).toBe(
      [
        "[review page] the checks on #12 (acme/shop) have finished: 1 passed, 1 failed",
        "  all checks: https://github.com/acme/shop/pull/12/checks",
      ].join("\n"),
    );
  });
});

test("a gh that can't start leaves the poller with an error to show, not a crash", async () => {
  const review = new Review(loaded(), async () => loaded());
  const poller = new Poller({
    review,
    cwd: "/nowhere",
    runner: async () => {
      throw new Error('Executable not found in $PATH: "gh"');
    },
    watching: () => true,
    avatars: new Map(),
    onChange: () => {},
  });
  await poller.tick();
  const layer = review.response.layers[0];
  expect(layer && (await poller.get(layer)).error).toContain("gh didn't run");
});
