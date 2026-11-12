import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";

import type { Review } from "./review";

export type Who = "page" | "session";
export type Env = { Variables: { who: Who } };

export const only = (who: Who) =>
  createMiddleware<Env>(async (c, next) => {
    if (c.get("who") !== who) {
      return c.json({ error: `only the ${who} may call this` }, 403);
    }
    await next();
  });

export const small = bodyLimit({ maxSize: 64 * 1024 });

// The :layer of a route: a layer of this review, by its id.
export const findLayer = (review: Review, param: string) => (/^\d{1,9}$/.test(param) ? review.layer(Number(param)) : undefined);
