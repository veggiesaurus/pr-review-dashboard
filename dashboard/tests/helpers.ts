import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../server/app";
import { type Runner, reviewedRepo } from "../server/comments";
import { run } from "../server/exec";
import { type Loaded, toLoaded } from "../server/load";
import { People } from "../server/people";
import { Review } from "../server/review";
import { Share, type Spawn } from "../server/share";
import { SignIn } from "../server/signin";
import { Store } from "../server/store";
import type { Person } from "../shared/messages";

export const PORT = 4321;
export const HOST = `127.0.0.1:${PORT}`;
export const ORIGIN = `http://${HOST}`;
export const TOKEN = "t".repeat(48);
export const LINK = "l".repeat(48);
export const COOKIE = "c".repeat(48);
export const GUEST_CODE = "g".repeat(48);
export const LINEAR_KEY = "lin_api_test";
export const OWNER: Person = { id: 1, login: "olive", name: "Olive Owner", avatar: "https://avatars.githubusercontent.com/u/1" };
export const GUEST: Person = { id: 2, login: "gus", name: null, avatar: "https://avatars.githubusercontent.com/u/2" };
export const TUNNEL = "quiet-river-1234.trycloudflare.com";

// A cloudflared that prints these lines to stderr and runs until it is killed or told to exit.
export function fakeCloudflared(lines = ["INF Requesting new quick Tunnel on trycloudflare.com...", `INF |  https://${TUNNEL}  |`]) {
  const commands: string[][] = [];
  const killed: string[][] = [];
  const exits: ((code: number) => void)[] = [];
  const spawn: Spawn = cmd => {
    commands.push(cmd);
    const { promise: exited, resolve } = Promise.withResolvers<number>();
    let close = () => {};
    const stderr = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(new TextEncoder().encode(`${line}\n`));
        }
        close = () => controller.close();
      },
    });
    let running = true;
    const exit = (code: number) => {
      if (running) {
        running = false;
        close();
        resolve(code);
      }
    };
    exits.push(exit);
    return {
      stderr,
      exited,
      kill: () => {
        killed.push(cmd);
        exit(143);
      },
    };
  };
  // exit: the last one started stops by itself.
  return { spawn, commands, killed, exit: (code = 0) => exits.at(-1)?.(code) };
}

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
    guestCode?: () => string | null;
    clientId?: string;
  } = {},
) {
  const review = new Review(loaded(options.raw), options.load ?? (async () => loaded(options.raw)));
  const attachments = mkdtempSync(join(tmpdir(), "prg-attachments-"));
  const store = new Store(review, { attachments });
  const people = new People();
  people.owner = OWNER;
  const guestSession = people.issue(GUEST);
  const cloudflared = fakeCloudflared();
  const share = new Share({
    port: () => PORT,
    spawn: cloudflared.spawn,
    which: () => "/usr/local/bin/cloudflared",
    people,
    onChange: () => {
      if (!share.link) {
        signIn.dropWaiting();
      }
      store.notify("session");
    },
  });
  const signIn = new SignIn({
    clientId: options.clientId ?? "client-1",
    fetcher: options.fetcher ?? fetch,
    runner: options.runner ?? run,
    repo: () => reviewedRepo(review) ?? "",
    sleep: async () => {},
    onChange: () => store.notify("session"),
  });
  const app = createApp({
    store,
    review,
    token: TOKEN,
    linkCode: LINK,
    cookieSecret: COOKIE,
    port: () => PORT,
    repo: options.repo ?? staticDir,
    staticDir,
    attachments,
    linearKey: LINEAR_KEY,
    fetcher: options.fetcher,
    runner: options.runner,
    githubComments: options.githubComments,
    onActivity: options.onActivity,
    host: options.host,
    people,
    share,
    signIn,
    guestCode: options.guestCode ?? (() => share.guestCode),
  });
  const session = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { host: HOST, authorization: `Bearer ${TOKEN}`, ...init.headers } });
  const page = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { host: HOST, origin: ORIGIN, cookie: `prg_${PORT}=${COOKIE}`, "x-prg-key": LINK, ...init.headers },
    });
  const guest = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { host: HOST, origin: ORIGIN, cookie: `prg_guest_${PORT}=${guestSession}`, "x-prg-key": GUEST_CODE, ...init.headers },
    });
  const post = (body: unknown): RequestInit => ({
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return { app, store, review, session, page, guest, post, attachments, people, share, signIn, cloudflared };
}

export const addedLine = { kind: "line", layer: 12, file: "f1", hunk: "f1h1", side: "R", line: 2 };
