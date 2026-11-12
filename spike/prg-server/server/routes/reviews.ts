import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { findingsSchema, reviewRequestSchema } from "../../shared/messages";
import type { AppDeps } from "../app";
import { type Env, only, small } from "../guards";

const number = (param: string) => (/^\d{1,9}$/.test(param) ? Number(param) : 0);

export function reviewsRoutes({ store }: AppDeps) {
  const app = new Hono<Env>();

  // The user asks Claude to review one PR; the request is a thread, and the session is told how to answer.
  app.post("/reviews", only("page"), small, zValidator("json", reviewRequestSchema), c => {
    const { layer, effort } = c.req.valid("json");
    const request = store.requestReview(layer, effort);
    return request ? c.json(request, 201) : c.json({ error: "that pull request isn't in this review" }, 400);
  });

  // The session hands over what the review found; each finding becomes a thread Claude starts.
  app.post("/reviews/:n/findings", only("session"), small, zValidator("json", findingsSchema), c => {
    const threads = store.addFindings(number(c.req.param("n")), c.req.valid("json").findings);
    return threads ? c.json(threads, 201) : c.json({ error: "no review with that number" }, 404);
  });

  app.post("/reviews/:n/archive", only("page"), c => {
    const archived = store.archiveReview(number(c.req.param("n")));
    return archived ? c.json({ archived }) : c.json({ error: "no review with that number" }, 404);
  });

  return app;
}
