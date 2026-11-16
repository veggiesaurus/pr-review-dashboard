import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";

import type { Author } from "../shared/messages";
import type { Review } from "./review";

export type Who = "owner" | "guest" | "session";
export type Env = { Variables: { who: Who; author: Author | null; tunnel: boolean } };

// The error names the first role allowed, so a guest refused an owner route reads "only the owner may do this".
export const only = (...allowed: Who[]) =>
  createMiddleware<Env>(async (c, next) => {
    if (!allowed.includes(c.get("who"))) {
      return c.json({ error: `only the ${allowed[0]} may do this` }, 403);
    }
    await next();
  });

export const small = bodyLimit({ maxSize: 64 * 1024 });

// The :layer of a route: a layer of this review, by its id.
export const findLayer = (review: Review, param: string) => (/^\d{1,9}$/.test(param) ? review.layer(Number(param)) : undefined);
