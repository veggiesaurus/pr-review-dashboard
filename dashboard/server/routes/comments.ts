import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { type CommentsResponse, type PostPreview, postSchema, previewSchema } from "../../shared/comments";
import type { AppDeps } from "../app";
import { buildPreview, githubLogin, postReview, readThreads, type ThreadsRead } from "../comments";
import { run } from "../exec";
import { isGithubAvatarHost } from "../github";
import { type Env, findLayer, only, small } from "../guards";
import { type Avatar, avatarHeaders, fetchAvatar } from "../linear";

const THREADS_CACHE_MS = 60_000;
const OFF = "Posting to GitHub is off. Start the server with --github-comments to allow it.";

export function commentsRoutes(deps: AppDeps) {
  const app = new Hono<Env>();
  const runner = deps.runner ?? run;
  const cache = new Map<number, { at: number; value: Promise<ThreadsRead> }>();
  const avatars = new Map<string, Promise<Avatar | null>>();
  let posting = false;
  deps.review.onChange(() => cache.clear());

  const threadsOf = (layerId: number, fresh = false) => {
    const layer = deps.review.layer(layerId);
    if (!layer) {
      return null;
    }
    let entry = cache.get(layerId);
    if (!entry || fresh || Date.now() - entry.at > THREADS_CACHE_MS) {
      entry = { at: Date.now(), value: readThreads(runner, deps.repo, layer) };
      cache.set(layerId, entry);
    }
    return entry.value;
  };

  app.get("/layers/:layer/comments", async c => {
    const layer = findLayer(deps.review, c.req.param("layer"));
    if (!layer?.meta.number) {
      return c.json({ error: "this layer has no pull request" }, 404);
    }
    const read = (await threadsOf(layer.id, Boolean(c.req.query("fresh")))) as ThreadsRead;
    const body: CommentsResponse = {
      threads: read.threads,
      more: read.more,
      headMoved: read.head !== null && read.head !== layer.meta.headSha,
      canPost: Boolean(deps.githubComments),
      error: read.error,
      at: new Date().toISOString(),
    };
    return c.json(body);
  });

  // By login, and only for someone who wrote one of the threads read for this layer.
  app.get("/layers/:layer/comments/avatar/:login", async c => {
    const layer = findLayer(deps.review, c.req.param("layer"));
    const url = layer ? (await threadsOf(layer.id))?.avatars.get(c.req.param("login")) : undefined;
    if (!url) {
      return c.json({ error: "no picture" }, 404);
    }
    let image = avatars.get(url);
    if (!image) {
      image = fetchAvatar(url, deps.fetcher, isGithubAvatarHost);
      avatars.set(url, image);
    }
    const avatar = await image;
    if (!avatar) {
      avatars.delete(url);
      return c.json({ error: "no picture" }, 404);
    }
    return c.body(avatar.bytes, 200, avatarHeaders(avatar));
  });

  // What would be posted, worked out from the notes on the server, with the login it would go under.
  const preview = async (layerParam: string, request: { ids: string[]; mode: "pending" | "now"; summary: string }) => {
    const layer = findLayer(deps.review, layerParam);
    if (!layer?.meta.number) {
      return { status: 404 as const, error: "this layer has no pull request" };
    }
    const [login, read] = await Promise.all([githubLogin(runner, deps.repo), threadsOf(layer.id, true) as Promise<ThreadsRead>]);
    if (!login) {
      return { status: 502 as const, error: "gh didn't say who is logged in. Run gh auth status in a terminal." };
    }
    if (read.error) {
      return { status: 502 as const, error: `GitHub didn't answer: ${read.error}` };
    }
    const built = buildPreview(deps.review, layer, id => deps.store.find(id), request, {
      login,
      head: read.head,
      pendingReviews: read.pendingReviews,
    });
    return typeof built === "string" ? { status: 409 as const, error: built } : { status: 200 as const, preview: built };
  };

  app.post("/layers/:layer/comments/preview", only("page"), small, zValidator("json", previewSchema), async c => {
    if (!deps.githubComments) {
      return c.json({ error: OFF }, 403);
    }
    const result = await preview(c.req.param("layer"), c.req.valid("json"));
    return result.status === 200 ? c.json(result.preview) : c.json({ error: result.error }, result.status);
  });

  app.post("/layers/:layer/comments/post", only("page"), small, zValidator("json", postSchema), async c => {
    if (!deps.githubComments) {
      return c.json({ error: OFF }, 403);
    }
    if (posting) {
      return c.json({ error: "Already posting a review." }, 409);
    }
    posting = true;
    try {
      const request = c.req.valid("json");
      const result = await preview(c.req.param("layer"), request);
      if (result.status !== 200) {
        return c.json({ error: result.error }, result.status);
      }
      const shown: PostPreview = result.preview;
      if (shown.confirm !== request.confirm) {
        return c.json({ error: "What would be posted has changed since you looked. Check it again." }, 409);
      }
      if (shown.comments.length === 0) {
        return c.json({ error: "None of these notes can go on GitHub." }, 400);
      }
      if (shown.mode === "pending" && shown.pendingExists) {
        return c.json({ error: "You already have a pending review on this pull request. Submit or discard it on GitHub first." }, 409);
      }
      const posted = await postReview(runner, deps.repo, shown);
      if (!posted.ok) {
        return c.json({ error: `GitHub refused it: ${posted.error}` }, 502);
      }
      deps.store.markPosted(
        shown.comments.map(comment => comment.id),
        { at: new Date().toISOString(), pending: shown.mode === "pending", url: posted.url },
        request.keep,
      );
      cache.delete(Number(c.req.param("layer")));
      return c.json({ posted: shown.comments.length, url: posted.url, pending: shown.mode === "pending" });
    } finally {
      posting = false;
    }
  });

  return app;
}
