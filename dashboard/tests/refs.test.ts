import { describe, expect, test } from "bun:test";

import type { Runner } from "../server/github";
import type { AllowedRefs, GithubRefResponse } from "../shared/live";
import { loaded, rawReview, setup } from "./helpers";

const AVATAR = "https://avatars.githubusercontent.com/u/1?v=4";
const PNG = new Uint8Array([137, 80, 78, 71]);

const prAnswer = (number: number, avatarUrl = AVATAR) => ({
  data: {
    repository: {
      issueOrPullRequest: {
        __typename: "PullRequest",
        number,
        title: "Trims titles",
        url: `https://github.com/acme/shop/pull/${number}`,
        state: "OPEN",
        isDraft: false,
        updatedAt: "2026-11-01T10:00:00Z",
        baseRefName: "main",
        headRefName: "trim",
        additions: 3,
        deletions: 1,
        changedFiles: 1,
        author: { login: "thandi", avatarUrl },
        labels: {
          nodes: [
            { name: "bug", color: "d73a4a" },
            { name: "odd", color: "red;x" },
          ],
        },
        commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
      },
    },
  },
});

// gh stands in: every call is recorded, and each answers as a pull request with the number it was asked about.
function fakeGh(avatarUrl = AVATAR) {
  const calls: string[][] = [];
  const runner: Runner = async cmd => {
    calls.push(cmd);
    const number = Number(cmd.find(arg => arg.startsWith("number="))?.slice(7));
    return { code: 0, stdout: JSON.stringify(prAnswer(number, avatarUrl)), stderr: "" };
  };
  return { calls, runner };
}

function fakeLinear(teams: string[]) {
  const bodies: string[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    bodies.push(body);
    if (String(url) !== "https://api.linear.app/graphql") {
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    }
    if (body.includes("teams")) {
      return Response.json({ data: { teams: { nodes: teams.map(key => ({ key })) } } });
    }
    const id = JSON.parse(body).variables.id;
    return Response.json({ data: { issue: { identifier: id, title: "An issue", url: `https://linear.app/acme/issue/${id}` } } });
  }) as typeof fetch;
  return { bodies, fetcher };
}

// The fixture's review with its first section's text replaced.
async function withText(why: string, options: Parameters<typeof setup>[0] = {}) {
  const raw = structuredClone(rawReview);
  raw.sections[0] = { ...raw.sections[0], why } as (typeof raw.sections)[0];
  const app = setup({ ...options, load: async () => loaded(raw) });
  await app.review.reload();
  return app;
}

describe("references", () => {
  test("a reference the review's text holds is looked up with a read-only query; one outside it is refused without asking", async () => {
    const gh = fakeGh();
    const { page } = await withText("Follows #7, other/lib#3 and https://github.com/acme/shop/commit/abcdef1.", { runner: gh.runner });

    const allowed = (await (await page("/api/refs")).json()) as AllowedRefs;
    expect(allowed.github).toEqual(["acme/shop#7", "other/lib#3", "acme/shop@abcdef1"]);

    const found = await page("/api/github/acme/shop/issues/7");
    expect(found.status).toBe(200);
    expect(((await found.json()) as GithubRefResponse).ref).toMatchObject({
      kind: "pr",
      number: 7,
      state: "open",
      author: { login: "thandi", avatar: true },
      labels: [
        { name: "bug", color: "#d73a4a" },
        { name: "odd", color: null },
      ],
    });
    expect(gh.calls).toHaveLength(1);
    expect(gh.calls[0]?.slice(0, 3)).toEqual(["gh", "api", "graphql"]);
    expect(gh.calls[0]).toContain("-f");
    expect(gh.calls[0]).toContain("owner=acme");
    expect(gh.calls[0]).toContain("number=7");
    expect(gh.calls[0]?.find(arg => arg.startsWith("query="))).not.toMatch(/\bmutation\b/);

    for (const path of ["/api/github/acme/shop/issues/8", "/api/github/acme/other/issues/7", "/api/github/acme/shop/commits/abcdef2"]) {
      expect((await page(path)).status).toBe(404);
    }
    expect((await page("/api/github/acme/shop/issues/7")).status).toBe(200);
    expect(gh.calls).toHaveLength(1);
  });

  test("what the page sends doesn't widen the list, but Claude's replies do", async () => {
    const gh = fakeGh();
    const { page, session, post } = await withText("Nothing here.", { runner: gh.runner });

    expect((await page("/api/messages", post({ kind: "chat", text: "what about #8 and FRO-1?" }))).status).toBe(201);
    expect((await page("/api/github/acme/shop/issues/8")).status).toBe(404);
    expect(gh.calls).toHaveLength(0);

    expect((await session("/api/replies", post({ text: "#9 did the same." }))).status).toBe(201);
    expect((await page("/api/github/acme/shop/issues/9")).status).toBe(200);
    expect((await page("/api/github/acme/shop/issues/8")).status).toBe(404);
    expect(gh.calls).toHaveLength(1);
  });

  test("the server answers for at most sixty references of each kind", async () => {
    const gh = fakeGh();
    const many = Array.from({ length: 70 }, (_, i) => `#${i + 1}`).join(" ");
    const { page } = await withText(many, { runner: gh.runner });
    expect(((await (await page("/api/refs")).json()) as AllowedRefs).github).toHaveLength(60);
    expect((await page("/api/github/acme/shop/issues/60")).status).toBe(200);
    expect((await page("/api/github/acme/shop/issues/61")).status).toBe(404);
  });

  test("a Linear key in the text counts only when the workspace has that team, so UTF-8 is never sent to Linear", async () => {
    const linear = fakeLinear(["FRO"]);
    const { page } = await withText("Reads UTF-8 for FRO-9, see https://linear.app/acme/issue/FRO-10/slug.", { fetcher: linear.fetcher });

    expect(((await (await page("/api/refs")).json()) as AllowedRefs).linear).toEqual(["ABC-12", "FRO-9", "FRO-10"]);
    expect((await page("/api/linear/UTF-8")).status).toBe(404);
    expect((await page("/api/linear/FRO-9")).status).toBe(200);
    expect((await page("/api/linear/FRO-10")).status).toBe(200);
    expect(linear.bodies.some(body => body.includes("UTF-8"))).toBe(false);
  });

  test("a GitHub picture comes by login, only for someone the server has seen, from GitHub's avatar hosts, without credentials", async () => {
    const fetched: { url: string; auth: string | null }[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      fetched.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      if (String(url) === "https://avatars.githubusercontent.com/u/2") {
        return new Response(null, { status: 302, headers: { location: "https://evil.example/u/2.png" } });
      }
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    }) as typeof fetch;

    const good = await withText("Follows #7.", { runner: fakeGh().runner, fetcher });
    expect((await good.page("/api/github/avatar/thandi")).status).toBe(404);
    await good.page("/api/github/acme/shop/issues/7");
    const picture = await good.page("/api/github/avatar/thandi");
    expect(picture.status).toBe(200);
    expect(new Uint8Array(await picture.arrayBuffer())).toEqual(PNG);
    expect((await good.page("/api/github/avatar/sipho")).status).toBe(404);
    expect((await good.page("/api/github/avatar/..%2Fthandi")).status).toBe(404);

    const elsewhere = await withText("Follows #7.", { runner: fakeGh("https://evil.example/thandi.png").runner, fetcher });
    await elsewhere.page("/api/github/acme/shop/issues/7");
    expect((await elsewhere.page("/api/github/avatar/thandi")).status).toBe(404);

    const redirected = await withText("Follows #7.", { runner: fakeGh("https://avatars.githubusercontent.com/u/2").runner, fetcher });
    await redirected.page("/api/github/acme/shop/issues/7");
    expect((await redirected.page("/api/github/avatar/thandi")).status).toBe(404);

    expect(fetched.map(call => call.url)).toEqual([AVATAR, "https://avatars.githubusercontent.com/u/2"]);
    expect(fetched.every(call => call.auth === null)).toBe(true);
  });
});
