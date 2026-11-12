import { Hono } from "hono";

import { USAGE_QUERY } from "../../shared/usage";
import type { AppDeps } from "../app";
import { commitDetails, usages } from "../git";
import { type Env, findLayer } from "../guards";

export function usagesRoutes(deps: AppDeps) {
  const app = new Hono<Env>();

  app.get("/layers/:layer/usages", async c => {
    const layer = findLayer(deps.review, c.req.param("layer"));
    if (!layer) {
      return c.json({ error: "no such layer" }, 404);
    }
    const sha = layer.meta.headSha;
    const query = c.req.query("q") ?? "";
    if (!sha) {
      return c.json({ error: "this layer has no head commit" }, 404);
    }
    if (!USAGE_QUERY.test(query)) {
      return c.json({ error: "search for one identifier" }, 400);
    }
    return c.json(await usages(deps.repo, sha, query));
  });

  app.get("/layers/:layer/commits", async c => {
    const layer = findLayer(deps.review, c.req.param("layer"));
    if (!layer) {
      return c.json({ error: "no such layer" }, 404);
    }
    return c.json({ commits: await commitDetails(deps.repo, layer.meta.shas ?? []) });
  });

  return app;
}
