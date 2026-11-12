import { Hono } from "hono";

import type { AppDeps } from "../app";
import type { Env } from "../guards";
import { type Avatar, avatarHeaders, fetchAvatar, type LinearLookup, linearIssue } from "../linear";
import { refIndex } from "../refs";

export function linearRoutes(deps: AppDeps) {
  const app = new Hono<Env>();
  const found = new Map<string, LinearLookup>();
  const avatars = new Map<string, Promise<Avatar | null>>();
  deps.review.onChange(() => {
    found.clear();
    avatars.clear();
  });

  // Null for an issue the review's text doesn't name, so the page can't use the key to read the rest of the workspace.
  const lookup = async (key: string) => {
    if (!(await refIndex(deps).linear()).includes(key)) {
      return null;
    }
    let hit = found.get(key);
    if (!hit) {
      hit = await linearIssue(key, deps.linearKey, deps.fetcher);
      if (hit.response.reason !== "failed") {
        found.set(key, hit);
      }
    }
    return hit;
  };

  app.get("/linear/:key", async c => {
    const hit = await lookup(c.req.param("key"));
    return hit ? c.json(hit.response) : c.json({ error: "this review doesn't name that issue" }, 404);
  });

  app.get("/linear/:key/avatar/:who", async c => {
    const who = c.req.param("who");
    const url = who === "assignee" || who === "creator" ? (await lookup(c.req.param("key")))?.avatars[who] : undefined;
    if (!url) {
      return c.json({ error: "no picture" }, 404);
    }
    let image = avatars.get(url);
    if (!image) {
      image = fetchAvatar(url, deps.fetcher);
      avatars.set(url, image);
    }
    const avatar = await image;
    if (!avatar) {
      avatars.delete(url);
      return c.json({ error: "no picture" }, 404);
    }
    return c.body(avatar.bytes, 200, avatarHeaders(avatar));
  });

  return app;
}
