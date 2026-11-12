import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../server/app";
import type { Runner } from "../server/comments";
import { type Loaded, toLoaded } from "../server/load";
import { Review } from "../server/review";
import { Store } from "../server/store";

export const PORT = 4321;
export const HOST = `127.0.0.1:${PORT}`;
export const ORIGIN = `http://${HOST}`;
export const TOKEN = "t".repeat(48);
export const LINK = "l".repeat(48);
export const COOKIE = "c".repeat(48);
export const LINEAR_KEY = "lin_api_test";

export const staticDir = mkdtempSync(join(tmpdir(), "prg-static-"));
writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>page</title>");

// One PR as render.py would hand it over, cut down to what the server reads.
export const rawReview = {
  meta: { repo: "acme/shop", number: 12, title: "ABC-12 moves the slug helper", head: "abc-12-slugs", headSha: "a".repeat(40) },
  files: [
    {
      id: "f1",
      path: "src/slug.ts",
      status: "modified",
      newText: ["export function slug(title: string) {", "  return title.trim().toLowerCase();", "}", ""],
      hunks: [
        {
          id: "f1h1",
          oldStart: 1,
          newStart: 1,
          lines: [
            [" ", 1, 1, "export function slug(title: string) {"],
            ["-", 2, null, "  return title.toLowerCase();"],
            ["+", null, 2, "  return title.trim().toLowerCase();"],
          ],
        },
      ],
    },
  ],
  sections: [{ kind: "guide", title: "Trim titles", why: "w", how: "h", risk: "", files: [{ id: "f1", hunks: ["f1h1"] }] }],
  tells: [{ kind: "debug", label: "debug output left in", file: "f1", hunk: "f1h1", line: "R2", text: "return title.trim()" }],
};

export const loaded = (raw: unknown = rawReview, renderError: string | null = null): Loaded => toLoaded(structuredClone(raw), renderError);

export function setup(
  options: {
    fetcher?: typeof fetch;
    load?: () => Promise<Loaded>;
    runner?: Runner;
    githubComments?: boolean;
    raw?: unknown;
    onActivity?: () => void;
    host?: string;
    repo?: string;
  } = {},
) {
  const review = new Review(loaded(options.raw), options.load ?? (async () => loaded(options.raw)));
  const store = new Store(review);
  const app = createApp({
    store,
    review,
    token: TOKEN,
    linkCode: LINK,
    cookieSecret: COOKIE,
    port: () => PORT,
    repo: options.repo ?? staticDir,
    staticDir,
    linearKey: LINEAR_KEY,
    fetcher: options.fetcher,
    runner: options.runner,
    githubComments: options.githubComments,
    onActivity: options.onActivity,
    host: options.host,
  });
  const session = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { host: HOST, authorization: `Bearer ${TOKEN}`, ...init.headers } });
  const page = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { host: HOST, origin: ORIGIN, cookie: `prg_${PORT}=${COOKIE}`, "x-prg-key": LINK, ...init.headers },
    });
  const post = (body: unknown): RequestInit => ({
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return { app, store, review, session, page, post };
}

export const addedLine = { kind: "line", layer: 12, file: "f1", hunk: "f1h1", side: "R", line: 2 };
