import { z } from "zod";

import type {
  Check,
  CheckBucket,
  CheckCounts,
  GithubLive,
  GithubPerson,
  GithubRefInfo,
  GithubRefResponse,
  Preview,
  Reviewer,
  ReviewState,
} from "../shared/live";
import type { Layer } from "../shared/payload";
import { REPO, type Ref } from "../shared/refs";
import { parseJson, type RunResult, run } from "./exec";
import { flat } from "./format";
import type { Review } from "./review";

export type Runner = (cmd: string[], cwd: string, timeoutMs?: number) => Promise<RunResult>;
// Picture addresses stay on the server, keyed by login.
export type Avatars = Map<string, string>;

const LIVE_QUERY = `query Live($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state isDraft reviewDecision mergeable mergeStateStatus headRefOid headRefName baseRefName url body createdAt
      author { __typename login avatarUrl(size: 64) }
      latestReviews(first: 30) { nodes { state author { login avatarUrl(size: 64) } } }
      reviewRequests(first: 30) {
        nodes { requestedReviewer { __typename ... on User { login avatarUrl(size: 64) } ... on Bot { login avatarUrl(size: 64) } ... on Team { name } } }
      }
      comments(last: 30) { nodes { body author { __typename login } } }
      commits(last: 1) {
        nodes {
          commit {
            deployments(last: 10) { nodes { environment latestStatus { state environmentUrl } } }
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun {
                    name status conclusion startedAt completedAt detailsUrl
                    checkSuite { workflowRun { workflow { name } } }
                  }
                  ... on StatusContext { context state targetUrl createdAt }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

const COUNTS =
  "statusCheckRollup { contexts(first: 1) { checkRunCountsByState { state count } statusContextCountsByState { state count } } }";
const PERSON = "author { login avatarUrl(size: 64) }";
const LABELS = "labels(first: 10) { nodes { name color } }";

const ISSUE_QUERY = `query Ref($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue { number title url state stateReason updatedAt ${PERSON} ${LABELS} comments { totalCount } }
      ... on PullRequest {
        number title url state isDraft updatedAt baseRefName headRefName additions deletions changedFiles ${PERSON} ${LABELS}
        commits(last: 1) { nodes { commit { ${COUNTS} } } }
      }
    }
  }
}`;

const COMMIT_QUERY = `query Commit($owner: String!, $name: String!, $sha: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: $sha) {
      __typename
      ... on Commit {
        oid messageHeadline committedDate additions deletions changedFilesIfAvailable url
        author { name user { login avatarUrl(size: 64) } }
        ${COUNTS}
      }
    }
  }
}`;

const link = z.string().startsWith("https://");
const userSchema = z.object({ __typename: z.string().optional(), login: z.string(), avatarUrl: z.string().nullish() });
const labelsSchema = z.object({ nodes: z.array(z.object({ name: z.string(), color: z.string().nullish() })) }).nullish();
const countsSchema = z
  .object({
    contexts: z.object({
      checkRunCountsByState: z.array(z.object({ state: z.string(), count: z.number() })).nullish(),
      statusContextCountsByState: z.array(z.object({ state: z.string(), count: z.number() })).nullish(),
    }),
  })
  .nullish();

const contextSchema = z.union([
  z.object({
    __typename: z.literal("CheckRun"),
    name: z.string(),
    status: z.string(),
    conclusion: z.string().nullish(),
    startedAt: z.string().nullish(),
    completedAt: z.string().nullish(),
    detailsUrl: z.string().nullish(),
    checkSuite: z.object({ workflowRun: z.object({ workflow: z.object({ name: z.string() }) }).nullish() }).nullish(),
  }),
  z.object({
    __typename: z.literal("StatusContext"),
    context: z.string(),
    state: z.string(),
    targetUrl: z.string().nullish(),
    createdAt: z.string().nullish(),
  }),
]);

const liveSchema = z.object({
  data: z.object({
    repository: z
      .object({
        pullRequest: z
          .object({
            state: z.string(),
            isDraft: z.boolean(),
            reviewDecision: z.string().nullish(),
            mergeable: z.string(),
            mergeStateStatus: z.string().nullish(),
            createdAt: z.string().nullish(),
            headRefOid: z.string(),
            headRefName: z.string(),
            baseRefName: z.string(),
            url: link,
            body: z.string().nullish(),
            author: userSchema.nullish(),
            latestReviews: z.object({ nodes: z.array(z.object({ state: z.string(), author: userSchema.nullish() })) }).nullish(),
            reviewRequests: z
              .object({
                nodes: z.array(
                  z.object({
                    requestedReviewer: z
                      .object({
                        __typename: z.string(),
                        login: z.string().optional(),
                        avatarUrl: z.string().nullish(),
                        name: z.string().optional(),
                      })
                      .nullish(),
                  }),
                ),
              })
              .nullish(),
            comments: z.object({ nodes: z.array(z.object({ body: z.string(), author: userSchema.nullish() })) }).nullish(),
            commits: z.object({
              nodes: z.array(
                z.object({
                  commit: z.object({
                    deployments: z
                      .object({
                        nodes: z.array(
                          z.object({
                            environment: z.string().nullish(),
                            latestStatus: z.object({ state: z.string(), environmentUrl: z.string().nullish() }).nullish(),
                          }),
                        ),
                      })
                      .nullish(),
                    statusCheckRollup: z.object({ contexts: z.object({ nodes: z.array(z.unknown()) }) }).nullish(),
                  }),
                }),
              ),
            }),
          })
          .nullish(),
      })
      .nullish(),
  }),
});

const refSchema = z.object({
  data: z.object({
    repository: z
      .object({
        issueOrPullRequest: z
          .discriminatedUnion("__typename", [
            z.object({
              __typename: z.literal("Issue"),
              number: z.number(),
              title: z.string(),
              url: link,
              state: z.string(),
              stateReason: z.string().nullish(),
              updatedAt: z.string().nullish(),
              author: userSchema.nullish(),
              labels: labelsSchema,
              comments: z.object({ totalCount: z.number() }).nullish(),
            }),
            z.object({
              __typename: z.literal("PullRequest"),
              number: z.number(),
              title: z.string(),
              url: link,
              state: z.string(),
              isDraft: z.boolean(),
              updatedAt: z.string().nullish(),
              baseRefName: z.string(),
              headRefName: z.string(),
              additions: z.number(),
              deletions: z.number(),
              changedFiles: z.number(),
              author: userSchema.nullish(),
              labels: labelsSchema,
              commits: z.object({ nodes: z.array(z.object({ commit: z.object({ statusCheckRollup: countsSchema }) })) }),
            }),
          ])
          .nullish(),
        object: z
          .object({
            __typename: z.string(),
            oid: z.string().optional(),
            messageHeadline: z.string().optional(),
            committedDate: z.string().nullish(),
            additions: z.number().optional(),
            deletions: z.number().optional(),
            changedFilesIfAvailable: z.number().nullish(),
            url: link.optional(),
            author: z.object({ name: z.string().nullish(), user: userSchema.nullish() }).nullish(),
            statusCheckRollup: countsSchema,
          })
          .nullish(),
      })
      .nullish(),
  }),
});

const errorsSchema = z.object({ errors: z.array(z.object({ type: z.string().optional(), message: z.string() })) });

const HEX = /^[0-9a-f]{6}$/i;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const PREVIEW_LINK = /\[([^\]\n]{0,80}\bpreview)\]\((https:\/\/[^)\s]+)\)/gi;
const MAX_PREVIEWS = 5;

// GitHub's pictures come from its avatar hosts only, every hop.
export const isGithubAvatarHost = (host: string) =>
  host === "avatars.githubusercontent.com" || host.endsWith(".githubusercontent.com") || host === "github.com";

// A gh that can't start (not installed, a bad cwd) answers like a failed query, so the poller's timer never throws.
async function graphql(runner: Runner, cwd: string, query: string, vars: Record<string, string | number>): Promise<RunResult> {
  const fields = Object.entries(vars).flatMap(([name, value]) => [typeof value === "number" ? "-F" : "-f", `${name}=${value}`]);
  try {
    return await runner(["gh", "api", "graphql", "-f", `query=${query}`, ...fields], cwd);
  } catch (error) {
    return { code: -1, stdout: "", stderr: `gh didn't run: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function failure(result: RunResult, fallback: string) {
  const parsed = errorsSchema.safeParse(parseJson(result.stdout));
  const said = parsed.success ? parsed.data.errors.map(e => e.message).join("; ") : result.stderr.trim();
  return { notFound: parsed.success && parsed.data.errors.some(e => e.type === "NOT_FOUND"), message: (said || fallback).slice(0, 300) };
}

function person(raw: z.infer<typeof userSchema> | null | undefined, avatars: Avatars): GithubPerson | null {
  if (!raw || !LOGIN.test(raw.login)) {
    return null;
  }
  if (raw.avatarUrl?.startsWith("https://")) {
    avatars.set(raw.login.toLowerCase(), raw.avatarUrl);
  }
  return { login: raw.login, avatar: avatars.has(raw.login.toLowerCase()) };
}

const colour = (value: string | null | undefined) => (value && HEX.test(value) ? `#${value.toLowerCase()}` : null);
const labels = (raw: z.infer<typeof labelsSchema>) => (raw?.nodes ?? []).map(label => ({ name: label.name, color: colour(label.color) }));

// gh's own buckets, so the counts match what collect.py saw.
export function bucket(state: string): CheckBucket {
  switch (state) {
    case "SUCCESS":
      return "pass";
    case "SKIPPED":
    case "NEUTRAL":
      return "skipping";
    case "ERROR":
    case "FAILURE":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
      return "fail";
    case "CANCELLED":
      return "cancel";
    default:
      return "pending";
  }
}

function toChecks(nodes: unknown[]): Check[] {
  const latest = new Map<string, Check>();
  for (const node of nodes) {
    const parsed = contextSchema.safeParse(node);
    if (!parsed.success) {
      continue;
    }
    const raw = parsed.data;
    const check: Check =
      raw.__typename === "CheckRun"
        ? {
            name: raw.name,
            state: raw.status === "COMPLETED" ? (raw.conclusion ?? "COMPLETED") : raw.status,
            bucket: bucket(raw.status === "COMPLETED" ? (raw.conclusion ?? "") : raw.status),
            link: raw.detailsUrl?.startsWith("https://") ? raw.detailsUrl : null,
            workflow: raw.checkSuite?.workflowRun?.workflow.name ?? null,
            startedAt: raw.startedAt ?? null,
            completedAt: raw.completedAt ?? null,
          }
        : {
            name: raw.context,
            state: raw.state,
            bucket: bucket(raw.state),
            link: raw.targetUrl?.startsWith("https://") ? raw.targetUrl : null,
            workflow: null,
            startedAt: raw.createdAt ?? null,
            completedAt: null,
          };
    // A re-run leaves the earlier run in the rollup; gh shows the latest of each, and so does the page.
    const key = `${check.workflow}/${check.name}`;
    const before = latest.get(key);
    if (!before || (check.startedAt ?? "") >= (before.startedAt ?? "")) {
      latest.set(key, check);
    }
  }
  return [...latest.values()];
}

const REVIEW_STATES: Record<string, ReviewState> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};

function previews(body: string, comments: string[], deployments: Preview[]): Preview[] {
  const found = [...deployments];
  const scan = (text: string, from: Preview["from"]) => {
    for (const match of text.matchAll(PREVIEW_LINK)) {
      if (match[1] && match[2]) {
        found.push({ label: match[1].trim(), url: match[2], from });
      }
    }
  };
  scan(body, "description");
  for (const comment of comments) {
    scan(comment, "comment");
  }
  const seen = new Set<string>();
  return found.filter(p => !seen.has(p.url) && Boolean(seen.add(p.url))).slice(0, MAX_PREVIEWS);
}

export function parseLive(stdout: string, builtSha: string | null, avatars: Avatars): GithubLive | null {
  const parsed = liveSchema.safeParse(parseJson(stdout));
  const raw = parsed.success ? parsed.data.data.repository?.pullRequest : null;
  if (!raw) {
    return null;
  }
  const commit = raw.commits.nodes[0]?.commit;
  const reviewers: Reviewer[] = [];
  for (const review of raw.latestReviews?.nodes ?? []) {
    const who = person(review.author, avatars);
    const state = REVIEW_STATES[review.state];
    if (who && state) {
      reviewers.push({ ...who, state, team: false });
    }
  }
  for (const request of raw.reviewRequests?.nodes ?? []) {
    const asked = request.requestedReviewer;
    if (asked?.__typename === "Team" && asked.name) {
      reviewers.push({ login: asked.name, avatar: false, state: "requested", team: true });
    } else if (asked?.login) {
      const who = person({ login: asked.login, avatarUrl: asked.avatarUrl }, avatars);
      if (who && !reviewers.some(r => r.login === who.login)) {
        reviewers.push({ ...who, state: "requested", team: false });
      }
    }
  }
  const author = person(raw.author, avatars);
  const deployments = (commit?.deployments?.nodes ?? []).flatMap(d =>
    d.latestStatus?.state === "SUCCESS" && d.latestStatus.environmentUrl?.startsWith("https://")
      ? [{ label: d.environment || "Preview", url: d.latestStatus.environmentUrl, from: "deployment" as const }]
      : [],
  );
  const comments = (raw.comments?.nodes ?? [])
    .filter(c => c.author && (c.author.__typename === "Bot" || c.author.login === author?.login))
    .map(c => c.body);
  return {
    pr: {
      state: raw.state,
      isDraft: raw.isDraft,
      reviewDecision: raw.reviewDecision || null,
      headSha: raw.headRefOid,
      builtSha,
      moved: builtSha !== null && raw.headRefOid !== builtSha,
      url: raw.url,
      base: raw.baseRefName,
      head: raw.headRefName,
      mergeable: raw.mergeable,
      mergeState: raw.mergeStateStatus ?? null,
      openedAt: raw.createdAt ?? null,
      author,
      reviewers,
      previews: previews(raw.body ?? "", comments, deployments),
    },
    checks: toChecks(commit?.statusCheckRollup?.contexts.nodes ?? []),
    error: null,
    at: new Date().toISOString(),
  };
}

const rulesSchema = z.array(
  z.object({
    type: z.string(),
    parameters: z.object({ required_status_checks: z.array(z.object({ context: z.string() })).nullish() }).nullish(),
  }),
);

// The checks a branch's rulesets require before a merge. A stacked PR's own base has none: GitHub holds every layer
// to the trunk's. Nothing readable is the same as nothing required.
export async function requiredChecks(runner: Runner, cwd: string, repo: string, branch: string): Promise<string[]> {
  if (!REPO.test(repo) || !branch) {
    return [];
  }
  try {
    const result = await runner(["gh", "api", `repos/${repo}/rules/branches/${encodeURIComponent(branch)}`], cwd);
    const rules = rulesSchema.safeParse(JSON.parse(result.stdout));
    return rules.success
      ? [...new Set(rules.data.flatMap(rule => (rule.parameters?.required_status_checks ?? []).map(check => check.context)))]
      : [];
  } catch {
    return [];
  }
}

const expected = (name: string): Check => ({
  name,
  bucket: "expected",
  state: "EXPECTED",
  link: null,
  workflow: null,
  startedAt: null,
  completedAt: null,
});

export async function githubLive(
  runner: Runner,
  cwd: string,
  layer: Layer,
  avatars: Avatars,
  required: string[] = [],
): Promise<GithubLive> {
  const { repo, number, headSha } = layer.meta;
  const empty = (error: string): GithubLive => ({ pr: null, checks: [], error, at: new Date().toISOString() });
  if (!repo || !REPO.test(repo) || !number) {
    return empty("This review doesn't say which pull request it is.");
  }
  const [owner, name] = repo.split("/") as [string, string];
  const result = await graphql(runner, cwd, LIVE_QUERY, { owner, name, number });
  const live = parseLive(result.stdout, headSha || null, avatars);
  if (!live) {
    return empty(failure(result, "gh couldn't read the pull request").message);
  }
  if (live.pr?.state === "OPEN") {
    const reported = new Set(live.checks.map(check => check.name));
    live.checks.push(...required.filter(name => !reported.has(name)).map(expected));
  }
  return live;
}

function counts(raw: z.infer<typeof countsSchema>): CheckCounts | null {
  const rows = [...(raw?.contexts.checkRunCountsByState ?? []), ...(raw?.contexts.statusContextCountsByState ?? [])];
  const total = rows.reduce((n, row) => n + row.count, 0);
  if (!raw || total === 0) {
    return null;
  }
  const sum = (b: CheckBucket) => rows.filter(row => bucket(row.state) === b).reduce((n, row) => n + row.count, 0);
  return { pass: sum("pass"), fail: sum("fail"), pending: sum("pending"), total };
}

function prState(state: string, isDraft: boolean): "open" | "draft" | "merged" | "closed" {
  if (state === "MERGED") {
    return "merged";
  }
  if (state === "CLOSED") {
    return "closed";
  }
  return isDraft ? "draft" : "open";
}

function issueState(state: string, reason: string | null | undefined) {
  if (state === "OPEN") {
    return "open" as const;
  }
  return reason === "COMPLETED" ? ("completed" as const) : reason === "NOT_PLANNED" ? ("not-planned" as const) : ("closed" as const);
}

export function parseRef(stdout: string, ref: Exclude<Ref, { kind: "linear" }>, avatars: Avatars): GithubRefInfo | null {
  const parsed = refSchema.safeParse(parseJson(stdout));
  const repository = parsed.success ? parsed.data.data.repository : null;
  if (ref.kind === "commit") {
    const raw = repository?.object;
    if (raw?.__typename !== "Commit" || !raw.oid || !raw.url) {
      return null;
    }
    return {
      kind: "commit",
      repo: ref.repo,
      sha: raw.oid,
      title: raw.messageHeadline ?? "",
      url: raw.url,
      author: person(raw.author?.user, avatars),
      authorName: raw.author?.name ?? null,
      updatedAt: raw.committedDate ?? null,
      additions: raw.additions ?? 0,
      deletions: raw.deletions ?? 0,
      files: raw.changedFilesIfAvailable ?? null,
      checks: counts(raw.statusCheckRollup),
    };
  }
  const raw = repository?.issueOrPullRequest;
  if (!raw) {
    return null;
  }
  const common = {
    repo: ref.repo,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    author: person(raw.author, avatars),
    labels: labels(raw.labels),
    updatedAt: raw.updatedAt ?? null,
  };
  if (raw.__typename === "Issue") {
    return { kind: "issue", ...common, state: issueState(raw.state, raw.stateReason), comments: raw.comments?.totalCount ?? 0 };
  }
  return {
    kind: "pr",
    ...common,
    state: prState(raw.state, raw.isDraft),
    base: raw.baseRefName,
    head: raw.headRefName,
    additions: raw.additions,
    deletions: raw.deletions,
    files: raw.changedFiles,
    checks: counts(raw.commits.nodes[0]?.commit.statusCheckRollup),
  };
}

export async function githubRef(
  runner: Runner,
  cwd: string,
  ref: Exclude<Ref, { kind: "linear" }>,
  avatars: Avatars,
): Promise<GithubRefResponse> {
  const [owner, name] = ref.repo.split("/") as [string, string];
  const result =
    ref.kind === "commit"
      ? await graphql(runner, cwd, COMMIT_QUERY, { owner, name, sha: ref.sha })
      : await graphql(runner, cwd, ISSUE_QUERY, { owner, name, number: ref.number });
  const found = parseRef(result.stdout, ref, avatars);
  if (found) {
    return { ref: found, reason: null };
  }
  const parsed = refSchema.safeParse(parseJson(result.stdout));
  // A short sha that names nothing comes back as a null object with no error.
  const missing = failure(result, "").notFound || (parsed.success && parsed.data.data.repository !== null && result.code === 0);
  return { ref: null, reason: missing ? "not-found" : "failed" };
}

// Polling: often while checks run, rarely once they settle, never while no page is open.
export const POLL = {
  fresh: 10_000,
  running: 20_000,
  settled: 180_000,
  closed: 600_000,
  failedBase: 60_000,
  failedMax: 600_000,
  rateLimited: 900_000,
};

type Entry = { live: GithubLive | null; fetchedAt: number; due: number; failures: number; pending: Promise<GithubLive> | null };

export type PollerOptions = {
  review: Review;
  cwd: string;
  runner?: Runner;
  now?: () => number;
  watching: () => boolean;
  avatars: Avatars;
  onChange: (layer: Layer, before: GithubLive, after: GithubLive) => void;
};

// What could change on the page: everything but when it was asked.
export const fingerprint = (live: GithubLive) =>
  JSON.stringify({
    pr: live.pr,
    error: live.error,
    checks: [...live.checks].sort((a, b) => `${a.workflow}/${a.name}`.localeCompare(`${b.workflow}/${b.name}`)),
  });

export class Poller {
  private readonly entries = new Map<number, Entry>();
  private readonly rules = new Map<string, { at: number; checks: Promise<string[]> }>();
  private readonly runner: Runner;
  private readonly now: () => number;

  constructor(private readonly options: PollerOptions) {
    this.runner = options.runner ?? run;
    this.now = options.now ?? Date.now;
    options.review.onChange(() => this.entries.clear());
  }

  // The trunk is the bottom layer's base on a stack, and the PR's own base otherwise. Its rules change rarely, so
  // they are asked for once in ten minutes.
  private required(layer: Layer): Promise<string[]> {
    const { stack, layers } = this.options.review.response;
    const trunk = (stack ? layers[0]?.meta.base : undefined) ?? layer.meta.base;
    const key = `${layer.meta.repo}@${trunk}`;
    const kept = this.rules.get(key);
    if (kept && this.now() - kept.at < 600_000) {
      return kept.checks;
    }
    const checks = requiredChecks(this.runner, this.options.cwd, layer.meta.repo, trunk);
    this.rules.set(key, { at: this.now(), checks });
    return checks;
  }

  // The route's answer: the last state, asked again when it is older than POLL.fresh or the page wants it now.
  get(layer: Layer, fresh = false): Promise<GithubLive> {
    const entry = this.entries.get(layer.id);
    if (entry?.live && !fresh && this.now() - entry.fetchedAt < POLL.fresh) {
      return Promise.resolve(entry.live);
    }
    return this.refresh(layer);
  }

  // Called every few seconds; does nothing unless a page is open, and only asks about layers that are due.
  async tick() {
    if (!this.options.watching()) {
      return;
    }
    const now = this.now();
    const due = this.options.review.response.layers.filter(layer => layer.meta.number && (this.entries.get(layer.id)?.due ?? 0) <= now);
    await Promise.all(due.map(layer => this.refresh(layer)));
  }

  private refresh(layer: Layer): Promise<GithubLive> {
    const entry = this.entries.get(layer.id) ?? { live: null, fetchedAt: 0, due: 0, failures: 0, pending: null };
    this.entries.set(layer.id, entry);
    entry.pending ??= this.required(layer)
      .then(required => githubLive(this.runner, this.options.cwd, layer, this.options.avatars, required))
      .then(next => {
        const before = entry.live;
        const now = this.now();
        entry.live = next;
        entry.fetchedAt = now;
        entry.failures = next.pr ? 0 : entry.failures + 1;
        entry.due = now + this.wait(next, entry.failures);
        if (before && fingerprint(before) !== fingerprint(next)) {
          this.options.onChange(layer, before, next);
        }
        return next;
      })
      .finally(() => {
        entry.pending = null;
      });
    return entry.pending;
  }

  private wait(live: GithubLive, failures: number) {
    if (!live.pr) {
      return /rate limit/i.test(live.error ?? "") ? POLL.rateLimited : Math.min(POLL.failedBase * 2 ** (failures - 1), POLL.failedMax);
    }
    if (live.pr.state !== "OPEN") {
      return POLL.closed;
    }
    return live.checks.some(check => check.bucket === "pending") ? POLL.running : POLL.settled;
  }
}

// One frame for the Claude session when a layer's checks finish or one fails, or null when neither happened.
export function ciFrame(layer: Layer, stacked: boolean, before: GithubLive, after: GithubLive): string | null {
  const failedBefore = new Set(before.checks.filter(c => c.bucket === "fail").map(c => `${c.workflow}/${c.name}`));
  const newlyFailed = after.checks.filter(c => c.bucket === "fail" && !failedBefore.has(`${c.workflow}/${c.name}`));
  const wasRunning = before.checks.some(c => c.bucket === "pending");
  const finished = wasRunning && after.checks.length > 0 && !after.checks.some(c => c.bucket === "pending");
  if (newlyFailed.length === 0 && !finished) {
    return null;
  }
  const pr = `#${layer.id}${stacked ? "" : ` (${flat(layer.meta.repo)})`}`;
  const lines: string[] = [];
  if (finished) {
    const count = (b: CheckBucket) => after.checks.filter(c => c.bucket === b).length;
    const parts = [`${count("pass")} passed`, `${count("fail")} failed`];
    if (count("cancel")) {
      parts.push(`${count("cancel")} cancelled`);
    }
    lines.push(`[review page] the checks on ${pr} have finished: ${parts.join(", ")}`);
  } else {
    lines.push(`[review page] ${newlyFailed.length === 1 ? "a check" : `${newlyFailed.length} checks`} failed on ${pr}`);
  }
  for (const check of newlyFailed) {
    lines.push(
      `  failed: "${flat(check.name)}"${check.workflow ? ` (${flat(check.workflow)})` : ""} ${check.link ? flat(check.link) : "(no link)"}`,
    );
  }
  if (after.pr?.url) {
    lines.push(`  all checks: ${flat(after.pr.url)}/checks`);
  }
  return lines.join("\n");
}
