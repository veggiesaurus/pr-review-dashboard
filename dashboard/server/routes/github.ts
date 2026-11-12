import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import type { AllowedRefs, CiNotify, GithubRefResponse } from "../../shared/live";
import { REPO, type Ref, refId, SHA } from "../../shared/refs";
import type { AppDeps } from "../app";
import { run } from "../exec";
import { type Avatars, ciFrame, githubRef, isGithubAvatarHost, Poller, type Runner } from "../github";
import { type Env, findLayer, only, small } from "../guards";
import { type Avatar, avatarHeaders, fetchAvatar } from "../linear";
import { refIndex } from "../refs";

const TICK_MS = 5_000;
const REF_MS = { found: 300_000, failed: 30_000 };
const MAX_GH = 4;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

// At most a few gh processes at once, however many references a page shows.
function limited(runner: Runner, max: number): Runner {
  let active = 0;
  const queue: (() => void)[] = [];
  return async (...args) => {
    if (active >= max) {
      await new Promise<void>(resolve => queue.push(resolve));
    }
    active++;
    try {
      return await runner(...args);
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

export function githubRoutes(deps: AppDeps) {
  const app = new Hono<Env>();
  const runner = limited(deps.runner ?? run, MAX_GH);
  const avatars: Avatars = new Map();
  const pictures = new Map<string, Promise<Avatar | null>>();
  const refs = new Map<string, { at: number; value: Promise<GithubRefResponse> }>();
  const notify: CiNotify = { on: false };
  deps.review.onChange(() => {
    refs.clear();
    pictures.clear();
  });

  const poller = new Poller({
    review: deps.review,
    cwd: deps.repo,
    runner,
    avatars,
    watching: () => deps.store.watching,
    onChange: (layer, before, after) => {
      deps.store.notify("github", layer.id);
      const frame = notify.on && deps.store.listening ? ciFrame(layer, deps.review.stacked, before, after) : null;
      if (frame) {
        deps.store.tell(frame);
      }
    },
  });
  setInterval(() => void poller.tick(), TICK_MS).unref();

  app.get("/layers/:layer/github", async c => {
    const layer = findLayer(deps.review, c.req.param("layer"));
    if (!layer) {
      return c.json({ error: "no such layer" }, 404);
    }
    if (!layer.meta.number) {
      return c.json({ error: "this layer has no pull request" }, 404);
    }
    return c.json(await poller.get(layer, Boolean(c.req.query("fresh"))));
  });

  app.get("/github/notify", c => c.json(notify));

  app.put("/github/notify", only("page"), small, zValidator("json", z.object({ on: z.boolean() })), c => {
    notify.on = c.req.valid("json").on;
    deps.store.notify("github");
    return c.json(notify);
  });

  app.get("/refs", async c => {
    const index = refIndex(deps);
    const body: AllowedRefs = { linear: await index.linear(), github: [...index.github().keys()] };
    return c.json(body);
  });

  // Only references the review's own text holds, so the page can't use the server to read anything else on GitHub.
  const lookup = (ref: Exclude<Ref, { kind: "linear" }>) => {
    const id = refId(ref);
    if (!refIndex(deps).github().has(id)) {
      return null;
    }
    let entry = refs.get(id);
    const now = Date.now();
    if (!entry || now - entry.at > REF_MS.found) {
      entry = { at: now, value: githubRef(runner, deps.repo, ref, avatars) };
      refs.set(id, entry);
      void entry.value.then(answer => {
        if (answer.reason === "failed" && entry) {
          entry.at = now - REF_MS.found + REF_MS.failed;
        }
      });
    }
    return entry.value;
  };

  app.get("/github/:owner/:name/:what{issues|commits}/:id", async c => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    const id = c.req.param("id");
    const what = c.req.param("what");
    const valid = REPO.test(repo) && (what === "issues" ? /^\d{1,7}$/.test(id) : SHA.test(id));
    const answer = valid
      ? lookup(what === "issues" ? { kind: "github", repo, number: Number(id) } : { kind: "commit", repo, sha: id })
      : null;
    return answer ? c.json(await answer) : c.json({ error: "this review doesn't mention that" }, 404);
  });

  // A GitHub user's picture, by login, for logins the server has seen in an answer it gave.
  app.get("/github/avatar/:login", async c => {
    const login = c.req.param("login");
    const url = LOGIN.test(login) ? avatars.get(login.toLowerCase()) : undefined;
    if (!url) {
      return c.json({ error: "no picture" }, 404);
    }
    let image = pictures.get(url);
    if (!image) {
      image = fetchAvatar(url, deps.fetcher, isGithubAvatarHost);
      pictures.set(url, image);
    }
    const avatar = await image;
    if (!avatar) {
      pictures.delete(url);
      return c.json({ error: "no picture" }, 404);
    }
    return c.body(avatar.bytes, 200, avatarHeaders(avatar));
  });

  return app;
}
