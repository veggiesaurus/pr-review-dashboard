import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { type PersonTicks, ticksSchema } from "../../shared/messages";
import type { AppDeps } from "../app";
import { type Env, only, small } from "../guards";

export function ticksRoutes({ store, people }: AppDeps) {
  const app = new Hono<Env>();

  app.get("/ticks", c => c.json(store.ticksFor(c.get("author"))));

  // Keys that aren't this review's are dropped; the answer is every tick the review has now.
  app.post("/ticks", only("owner", "guest"), small, zValidator("json", ticksSchema), c => {
    const { keys, done } = c.req.valid("json");
    return c.json(store.setTicks(keys, done, c.get("author")));
  });

  // Who else has ticked what: a guest sees what the owner has reviewed, and the owner who took a second look.
  app.get("/ticks/people", only("owner", "guest"), c => {
    const known = people.known();
    const others = store.ticksOfOthers(c.get("author")).map(
      ({ guest, keys }): PersonTicks => ({
        role: guest === null ? "owner" : "guest",
        person: guest === null ? people.owner : (known.find(p => p.id === guest) ?? store.authorOf(guest)),
        keys,
      }),
    );
    return c.json(others);
  });

  return app;
}
