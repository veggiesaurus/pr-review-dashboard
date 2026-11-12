import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { ticksSchema } from "../../shared/messages";
import type { AppDeps } from "../app";
import { type Env, only, small } from "../guards";

export function ticksRoutes({ store }: AppDeps) {
  const app = new Hono<Env>();

  app.get("/ticks", c => c.json(store.ticks));

  // Keys that aren't this review's are dropped; the answer is every tick the review has now.
  app.post("/ticks", only("page"), small, zValidator("json", ticksSchema), c => {
    const { keys, done } = c.req.valid("json");
    return c.json(store.setTicks(keys, done));
  });

  return app;
}
