import { describe, expect, test } from "bun:test";
import type { Runner } from "../server/comments";
import type { CommentsResponse, PostPreview } from "../shared/comments";
import type { Message } from "../shared/messages";
import { addedLine, setup } from "./helpers";

type Call = { cmd: string[]; input?: string };

const HEAD = "a".repeat(40);
const POSTED = { id: 7, html_url: "https://github.com/acme/shop/pull/12#pullrequestreview-7", state: "PENDING" };

function threadsJson(head = HEAD, pending = 0) {
  const comment = (id: string, login: string) => ({
    id,
    author: { login, avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
    body: "Is this trim needed?",
    createdAt: "2026-11-10T09:00:00Z",
    url: `https://github.com/acme/shop/pull/12#discussion_${id}`,
    state: "SUBMITTED",
  });
  const thread = (id: string, line: number | null, side: string, outdated: boolean) => ({
    id,
    isResolved: false,
    isOutdated: outdated,
    path: "src/slug.ts",
    line,
    startLine: null,
    diffSide: side,
    subjectType: "LINE",
    comments: { nodes: [comment(`${id}c`, "octo")] },
  });
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          headRefOid: head,
          reviews: { totalCount: pending },
          reviewThreads: {
            totalCount: 4,
            nodes: [
              thread("t1", 2, "RIGHT", false),
              thread("t2", 2, "LEFT", false),
              thread("t3", 1, "LEFT", false),
              thread("t4", null, "RIGHT", true),
            ],
          },
        },
      },
    },
  });
}

function stub(options: { head?: string; pending?: number; refuse?: string } = {}) {
  const calls: Call[] = [];
  const runner: Runner = async (cmd, _cwd, _timeout, input) => {
    calls.push({ cmd, input });
    const out = (stdout: string) => ({ code: 0, stdout, stderr: "" });
    if (cmd[2] === "graphql") {
      return out(threadsJson(options.head, options.pending));
    }
    if (cmd[2] === "user") {
      return out(JSON.stringify({ login: "angus", id: 1 }));
    }
    return options.refuse ? { code: 1, stdout: options.refuse, stderr: "gh: Validation Failed (HTTP 422)" } : out(JSON.stringify(POSTED));
  };
  return { calls, runner, posts: () => calls.filter(call => call.cmd.includes("--method")) };
}

async function withNotes(options: Parameters<typeof stub>[0] = {}, githubComments = true) {
  const fake = stub(options);
  const app = setup({ runner: fake.runner, githubComments });
  await app.page("/api/messages", app.post({ kind: "note", text: "Trim in the form instead.", anchor: addedLine }));
  await app.page("/api/messages", app.post({ kind: "note", text: "Both lines", anchor: { ...addedLine, side: "L" } }));
  await app.page("/api/messages", app.post({ kind: "note", text: "Nice section", anchor: { kind: "section", layer: 12, index: 0 } }));
  await app.page("/api/messages", app.post({ kind: "chat", text: "a question" }));
  fake.calls.length = 0;
  return { ...app, ...fake };
}

describe("GitHub review threads", () => {
  test("are read with gh api graphql and placed on the diff's lines; outdated ones aren't placed", async () => {
    const { page, calls } = await withNotes({}, false);
    const response = (await (await page("/api/layers/12/comments")).json()) as CommentsResponse;
    expect(calls[0]?.cmd.slice(0, 3)).toEqual(["gh", "api", "graphql"]);
    expect(calls[0]?.cmd).toContain("-F");
    expect(calls[0]?.cmd).toContain("number=12");
    expect(response.canPost).toBe(false);
    expect(response.threads.map(t => t.place)).toEqual([
      { file: "f1", hunk: "f1h1", side: "R", line: 2 },
      { file: "f1", hunk: "f1h1", side: "L", line: 2 },
      { file: "f1", hunk: "f1h1", side: "R", line: 1 },
      null,
    ]);
    expect(response.threads[0]?.comments[0]).toMatchObject({ author: "octo", avatar: true, pending: false });
    expect(JSON.stringify(response)).not.toContain("avatars.githubusercontent.com");

    await page("/api/layers/12/comments");
    expect(calls).toHaveLength(1);
  });

  test("pictures come through the server, only for someone who wrote a thread", async () => {
    const fetched: string[] = [];
    const fake = stub();
    const fetcher = (async (url: URL | string) => {
      fetched.push(String(url));
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
    }) as typeof fetch;
    const { page } = setup({ runner: fake.runner, fetcher });
    expect((await page("/api/layers/12/comments/avatar/octo")).status).toBe(200);
    expect((await page("/api/layers/12/comments/avatar/someone-else")).status).toBe(404);
    expect(fetched).toEqual(["https://avatars.githubusercontent.com/u/1?v=4"]);
  });
});

describe("posting notes as a review", () => {
  const preview = (page: ReturnType<typeof setup>["page"], post: ReturnType<typeof setup>["post"], body: unknown) =>
    page("/api/layers/12/comments/preview", post(body));

  test("is off without --github-comments, and nothing runs", async () => {
    const { page, post, calls } = await withNotes({}, false);
    expect((await preview(page, post, { ids: ["m1"], mode: "pending" })).status).toBe(403);
    const posted = await page("/api/layers/12/comments/post", post({ ids: ["m1"], mode: "pending", confirm: "0".repeat(64) }));
    expect(posted.status).toBe(403);
    expect(calls).toEqual([]);
  });

  test("only the page may ask, never the session", async () => {
    const { session, post, calls } = await withNotes();
    expect((await session("/api/layers/12/comments/preview", post({ ids: ["m1"], mode: "pending" }))).status).toBe(403);
    expect((await session("/api/layers/12/comments/post", post({ ids: ["m1"], mode: "now", confirm: "0".repeat(64) }))).status).toBe(403);
    expect(calls).toEqual([]);
  });

  test("the preview shows the login, the PR, the commit and each comment; only notes on lines of this diff go", async () => {
    const { page, post, calls } = await withNotes();
    const shown = (await (await preview(page, post, { ids: ["m1", "m2", "m3", "m4", "m99"], mode: "pending" })).json()) as PostPreview;
    expect(calls.map(call => call.cmd.slice(0, 3).join(" ")).sort()).toEqual(["gh api graphql", "gh api user"]);
    expect(shown).toMatchObject({ login: "angus", repo: "acme/shop", number: 12, commit: HEAD, mode: "pending", pendingExists: false });
    expect(shown.comments).toEqual([
      { id: "m1", path: "src/slug.ts", line: 2, side: "RIGHT", body: "Trim in the form instead." },
      { id: "m2", path: "src/slug.ts", line: 2, side: "LEFT", body: "Both lines" },
    ]);
    expect(shown.refused).toEqual([
      { id: "m3", reason: "only a note on a line can be an inline comment" },
      { id: "m4", reason: "not one of your notes" },
      { id: "m99", reason: "not one of your notes" },
    ]);
  });

  test("posts exactly what was shown, as a pending review by default, and marks the notes", async () => {
    const { page, post, store, calls, posts } = await withNotes();
    const shown = (await (await preview(page, post, { ids: ["m1", "m2"], mode: "pending" })).json()) as PostPreview;
    const response = await page("/api/layers/12/comments/post", post({ ids: ["m1", "m2"], mode: "pending", confirm: shown.confirm }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ posted: 2, url: POSTED.html_url, pending: true });
    expect(posts()).toHaveLength(1);
    const [call] = posts();
    expect(call?.cmd).toEqual(["gh", "api", "--method", "POST", "repos/acme/shop/pulls/12/reviews", "--input", "-"]);
    expect(JSON.parse(call?.input ?? "")).toEqual({
      commit_id: HEAD,
      comments: [
        { path: "src/slug.ts", body: "Trim in the form instead.", line: 2, side: "RIGHT" },
        { path: "src/slug.ts", body: "Both lines", line: 2, side: "LEFT" },
      ],
    });
    expect(calls.filter(c => c.cmd[2] === "user")).toHaveLength(2);
    expect(store.messages.map(m => m.id)).toEqual(["m3", "m4"]);
  });

  test("a note on an unchanged line outside the diff stays off GitHub", async () => {
    const { page, post } = await withNotes();
    await page("/api/messages", post({ kind: "note", text: "brace", anchor: { ...addedLine, line: 3 } }));
    const shown = (await (await preview(page, post, { ids: ["m5"], mode: "pending" })).json()) as PostPreview;
    expect(shown.comments).toEqual([]);
    expect(shown.refused).toEqual([
      { id: "m5", reason: "it is on unchanged lines outside the diff, which GitHub doesn't take comments on" },
    ]);
  });

  test("post now sends the event and the summary, keeps the notes if asked, and a range goes as start_line", async () => {
    const { page, post, store, posts } = await withNotes();
    await page("/api/messages", post({ kind: "note", text: "range", anchor: { ...addedLine, line: 1, endLine: 2 } }));
    const ask = { ids: ["m5"], mode: "now", summary: "Two small things." };
    const shown = (await (await preview(page, post, ask)).json()) as PostPreview;
    expect((await page("/api/layers/12/comments/post", post({ ...ask, confirm: shown.confirm, keep: true }))).status).toBe(200);
    expect(JSON.parse(posts()[0]?.input ?? "")).toEqual({
      commit_id: HEAD,
      body: "Two small things.",
      event: "COMMENT",
      comments: [{ path: "src/slug.ts", body: "range", line: 2, side: "RIGHT", start_line: 1, start_side: "RIGHT" }],
    });
    expect(store.find("m5")?.posted).toMatchObject({ pending: false, url: POSTED.html_url });
    const again = (await (await preview(page, post, ask)).json()) as PostPreview;
    expect(again.refused).toEqual([{ id: "m5", reason: "already on GitHub" }]);
  });

  test("nothing is posted when the notes changed since the preview, or the confirmation is wrong", async () => {
    const { page, post, posts } = await withNotes();
    const shown = (await (await preview(page, post, { ids: ["m1"], mode: "pending" })).json()) as PostPreview;
    await page("/api/messages/m1", {
      method: "PATCH",
      body: JSON.stringify({ text: "changed" }),
      headers: { "content-type": "application/json" },
    });
    expect((await page("/api/layers/12/comments/post", post({ ids: ["m1"], mode: "pending", confirm: shown.confirm }))).status).toBe(409);
    expect((await page("/api/layers/12/comments/post", post({ ids: ["m1"], mode: "now", confirm: shown.confirm }))).status).toBe(409);
    expect(posts()).toEqual([]);
  });

  test("nothing is posted when the PR has moved past the guide's commit, or a pending review is already open", async () => {
    const moved = await withNotes({ head: "c".repeat(40) });
    const refused = await preview(moved.page, moved.post, { ids: ["m1"], mode: "now" });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toContain("moved past the commit");

    const busy = await withNotes({ pending: 1 });
    const shown = (await (await preview(busy.page, busy.post, { ids: ["m1"], mode: "pending" })).json()) as PostPreview;
    expect(shown.pendingExists).toBe(true);
    expect(
      (await busy.page("/api/layers/12/comments/post", busy.post({ ids: ["m1"], mode: "pending", confirm: shown.confirm }))).status,
    ).toBe(409);
    expect([...moved.posts(), ...busy.posts()]).toEqual([]);
  });

  test("GitHub's refusal is passed on and the notes stay as they were", async () => {
    const { page, post, store } = await withNotes({ refuse: JSON.stringify({ message: "Validation Failed" }) });
    const shown = (await (await preview(page, post, { ids: ["m1"], mode: "now" })).json()) as PostPreview;
    const response = await page("/api/layers/12/comments/post", post({ ids: ["m1"], mode: "now", confirm: shown.confirm }));
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBe("GitHub refused it: Validation Failed");
    expect((store.find("m1") as Message).posted).toBeUndefined();
  });
});
