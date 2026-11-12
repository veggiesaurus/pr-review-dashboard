import { createHash } from "node:crypto";

import { z } from "zod";

import type { GithubThread, PostMode, PostPreview, ReviewComment, ThreadPlace } from "../shared/comments";
import type { LineAnchor, Message } from "../shared/messages";
import type { Layer } from "../shared/payload";
import { resolveAnchor } from "./anchors";
import { parseJson, type RunResult } from "./exec";
import type { Review } from "./review";

export type Runner = (cmd: string[], cwd: string, timeoutMs?: number, input?: string) => Promise<RunResult>;

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const SHA = /^[0-9a-f]{40}$/;

const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid
      reviews(states: PENDING, first: 1) { totalCount }
      reviewThreads(first: 100) {
        totalCount
        nodes {
          id isResolved isOutdated path line startLine diffSide subjectType
          comments(first: 50) { nodes { id author { login avatarUrl } body createdAt url state } }
        }
      }
    }
  }
}`;

const threadsSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        headRefOid: z.string(),
        reviews: z.object({ totalCount: z.number() }),
        reviewThreads: z.object({
          totalCount: z.number(),
          nodes: z.array(
            z.object({
              id: z.string(),
              isResolved: z.boolean(),
              isOutdated: z.boolean(),
              path: z.string(),
              line: z.number().nullish(),
              startLine: z.number().nullish(),
              diffSide: z.enum(["LEFT", "RIGHT"]).nullish(),
              subjectType: z.string().nullish(),
              comments: z.object({
                nodes: z.array(
                  z.object({
                    id: z.string(),
                    author: z.object({ login: z.string(), avatarUrl: z.string().nullish() }).nullish(),
                    body: z.string(),
                    createdAt: z.string(),
                    url: z.string().nullish(),
                    state: z.string().nullish(),
                  }),
                ),
              }),
            }),
          ),
        }),
      }),
    }),
  }),
});

export type ThreadsRead = {
  threads: GithubThread[];
  more: boolean;
  head: string | null;
  pendingReviews: number;
  // Each author's picture address stays here; the page asks for it by login.
  avatars: Map<string, string>;
  error: string | null;
};

// Owner and name for gh, only from a plain "owner/name".
export function repoOf(layer: Layer) {
  const repo = layer.meta.repo ?? "";
  return REPO.test(repo) ? repo : null;
}

// The line of this layer's diff a thread is on. GitHub numbers LEFT in the base and RIGHT in the head; a comment on
// the left half of an unchanged line shows on the page's one copy of it, numbered in the head.
export function placeThread(
  layer: Layer,
  thread: Pick<GithubThread, "path" | "line" | "side" | "outdated" | "onFile">,
): ThreadPlace | null {
  if (thread.outdated || thread.onFile || thread.line === null) {
    return null;
  }
  const file = layer.files.find(f => f.path === thread.path);
  for (const hunk of file?.hunks ?? []) {
    const row = hunk.lines.find(([sign, oldNo, newNo]) =>
      thread.side === "LEFT" ? sign !== "+" && oldNo === thread.line : sign !== "-" && newNo === thread.line,
    );
    if (file && row) {
      return row[0] === "-"
        ? { file: file.id, hunk: hunk.id, side: "L", line: row[1] as number }
        : { file: file.id, hunk: hunk.id, side: "R", line: row[2] as number };
    }
  }
  return null;
}

export async function readThreads(run: Runner, cwd: string, layer: Layer): Promise<ThreadsRead> {
  const empty = (error: string): ThreadsRead => ({ threads: [], more: false, head: null, pendingReviews: 0, avatars: new Map(), error });
  const repo = repoOf(layer);
  if (!repo || !layer.meta.number) {
    return empty("this layer has no pull request on GitHub");
  }
  const [owner, name] = repo.split("/") as [string, string];
  const result = await run(
    [
      "gh",
      "api",
      "graphql",
      "-f",
      `query=${THREADS_QUERY}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-F",
      `number=${layer.meta.number}`,
    ],
    cwd,
  );
  const parsed = threadsSchema.safeParse(parseJson(result.stdout));
  if (!parsed.success) {
    return empty(result.stderr.trim().slice(0, 300) || "gh api graphql failed");
  }
  const pr = parsed.data.data.repository.pullRequest;
  const avatars = new Map<string, string>();
  const threads = pr.reviewThreads.nodes.map(node => {
    const comments = node.comments.nodes.map(comment => {
      const login = comment.author?.login ?? null;
      const picture = comment.author?.avatarUrl;
      if (login && picture?.startsWith("https://")) {
        avatars.set(login, picture);
      }
      return {
        id: comment.id,
        author: login,
        avatar: Boolean(login && avatars.has(login)),
        body: comment.body,
        at: comment.createdAt,
        url: comment.url?.startsWith("https://") ? comment.url : null,
        pending: comment.state === "PENDING",
      };
    });
    const thread = {
      id: node.id,
      path: node.path,
      line: node.line ?? null,
      startLine: node.startLine ?? null,
      side: node.diffSide ?? "RIGHT",
      resolved: node.isResolved,
      outdated: node.isOutdated,
      onFile: node.subjectType === "FILE",
      comments,
    } as const;
    return { ...thread, place: placeThread(layer, thread) };
  });
  return {
    threads,
    more: pr.reviewThreads.totalCount > threads.length,
    head: pr.headRefOid,
    pendingReviews: pr.reviews.totalCount,
    avatars,
    error: null,
  };
}

const userSchema = z.object({ login: z.string().regex(/^[A-Za-z0-9-]{1,39}$/) });

// Whose name a review would go out under.
export async function githubLogin(run: Runner, cwd: string) {
  const parsed = userSchema.safeParse(parseJson((await run(["gh", "api", "user"], cwd)).stdout));
  return parsed.success ? parsed.data.login : null;
}

// A note as an inline comment, only on a line of this layer's diff as the server finds it now.
function toComment(review: Review, layer: Layer, note: Message | undefined): ReviewComment | string {
  if (note?.from !== "user" || note.kind !== "note" || note.replyTo) {
    return "not one of your notes";
  }
  if (note.posted) {
    return "already on GitHub";
  }
  const { anchor } = note;
  if (anchor.outdated) {
    return "its line has gone from the diff since a rebuild";
  }
  if (anchor.kind !== "line" && anchor.kind !== "tell") {
    return "only a note on a line can be an inline comment";
  }
  if (anchor.layer !== layer.id) {
    return `it is on #${anchor.layer}, not this pull request`;
  }
  const line =
    anchor.kind === "line"
      ? anchor
      : (() => {
          const side = anchor.line[0] as "L" | "R";
          const n = Number(anchor.line.slice(1));
          const tell = layer.tells.find(t => t.file === anchor.file && t.line === anchor.line);
          const found: LineAnchor | null = tell
            ? { kind: "line", layer: layer.id, file: anchor.file, hunk: tell.hunk, side, line: n }
            : null;
          return found;
        })();
  const found = line ? resolveAnchor(review, line) : null;
  if (!line || !found?.path) {
    return "its line isn't in the diff";
  }
  const side = line.side === "L" ? "LEFT" : "RIGHT";
  const end = line.endLine ?? line.line;
  const rows = layer.files.find(f => f.id === line.file)?.hunks.find(h => h.id === line.hunk)?.lines ?? [];
  const inHunk = (n: number) =>
    rows.some(([sign, oldNo, newNo]) => (line.side === "L" ? sign !== "+" && oldNo === n : sign !== "-" && newNo === n));
  if (!inHunk(line.line) || !inHunk(end)) {
    return "it is on unchanged lines outside the diff, which GitHub doesn't take comments on";
  }
  return {
    id: note.id,
    path: found.path,
    line: end,
    side,
    ...(end !== line.line && { startLine: line.line, startSide: side }),
    // A nit and a question say so, as reviewers write them; a fix is what a review comment asks for anyway.
    body: note.intent && note.intent !== "fix" ? `${note.intent}: ${note.text}` : note.text,
  };
}

// The exact body gh sends to GitHub's create-a-review endpoint. Without an event GitHub keeps the review pending.
export function reviewBody(commit: string, mode: PostMode, summary: string, comments: ReviewComment[]) {
  return {
    commit_id: commit,
    ...(summary && { body: summary }),
    ...(mode === "now" && { event: "COMMENT" }),
    comments: comments.map(c => ({
      path: c.path,
      body: c.body,
      line: c.line,
      side: c.side,
      ...(c.startLine !== undefined && { start_line: c.startLine, start_side: c.startSide }),
    })),
  };
}

export function buildPreview(
  review: Review,
  layer: Layer,
  notes: (id: string) => Message | undefined,
  request: { ids: string[]; mode: PostMode; summary: string },
  context: { login: string; head: string | null; pendingReviews: number },
): PostPreview | string {
  const repo = repoOf(layer);
  const number = layer.meta.number;
  const commit = layer.meta.headSha;
  if (!repo || !number || !commit || !SHA.test(commit)) {
    return "this layer has no pull request on GitHub";
  }
  if (context.head !== commit) {
    return "The pull request has moved past the commit this guide was built from, so its line numbers may be wrong. Ask Claude to rebuild the guide first.";
  }
  const comments: ReviewComment[] = [];
  const refused: PostPreview["refused"] = [];
  for (const id of new Set(request.ids)) {
    const comment = toComment(review, layer, notes(id));
    if (typeof comment === "string") {
      refused.push({ id, reason: comment });
    } else {
      comments.push(comment);
    }
  }
  const body = reviewBody(commit, request.mode, request.summary, comments);
  const confirm = createHash("sha256")
    .update(JSON.stringify({ login: context.login, repo, number, body }))
    .digest("hex");
  return {
    login: context.login,
    repo,
    number,
    commit,
    mode: request.mode,
    summary: request.summary,
    comments,
    refused,
    pendingExists: context.pendingReviews > 0,
    confirm,
  };
}

const createdSchema = z.object({ id: z.number(), html_url: z.string().nullish() });

export async function postReview(run: Runner, cwd: string, preview: PostPreview) {
  const body = reviewBody(preview.commit, preview.mode, preview.summary, preview.comments);
  const result = await run(
    ["gh", "api", "--method", "POST", `repos/${preview.repo}/pulls/${preview.number}/reviews`, "--input", "-"],
    cwd,
    30_000,
    JSON.stringify(body),
  );
  const created = createdSchema.safeParse(parseJson(result.stdout));
  if (result.code !== 0 || !created.success) {
    const said = z.object({ message: z.string() }).safeParse(parseJson(result.stdout));
    return { ok: false as const, error: (said.success ? said.data.message : result.stderr.trim()).slice(0, 300) || "gh api failed" };
  }
  const url = created.data.html_url?.startsWith("https://") ? created.data.html_url : null;
  return { ok: true as const, url };
}
