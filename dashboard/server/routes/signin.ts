import { Hono } from "hono";
import { setCookie } from "hono/cookie";

import { type SignInWith, signInNameSchema } from "../../shared/messages";
import type { AppDeps } from "../app";
import { type Env, small } from "../guards";
import { browserOf } from "../signin";

// Enough for a team; past it the waiting list is someone with the link filling it.
export const MAX_WAITING = 20;

// Reached with the share link alone, before its holder is anyone.
export function signinRoutes({ signIn, people, share, port, store }: AppDeps) {
  const app = new Hono<Env>();

  app.get("/signin", c => c.json({ with: (signIn.clientId ? "github" : "name") satisfies SignInWith }));

  app.post("/signin", small, async c => {
    // Only Cloudflare sets cf-* headers, so they are trusted on the tunnel host alone.
    const country = c.req.header("host") === share.host ? c.req.header("cf-ipcountry") : undefined;
    const from = { country: country && /^[A-Z]{2}$/.test(country) ? country : null, browser: browserOf(c.req.header("user-agent")) };
    if (signIn.open() >= MAX_WAITING) {
      return c.json({ error: "too many people are waiting to be let in, so try again in a few minutes" }, 429);
    }
    if (signIn.clientId) {
      return c.json(await signIn.start(from));
    }
    const body = signInNameSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: "type your name, up to 40 letters, numbers, spaces, dots, hyphens and apostrophes" }, 400);
    }
    return c.json(signIn.named(body.data.name, from));
  });

  app.get("/signin/:id", c => {
    const status = signIn.status(c.req.param("id"));
    if (!status) {
      return c.json({ error: "no sign-in with that id" }, 404);
    }
    const person = status.state === "done" ? signIn.claim(c.req.param("id")) : null;
    if (person) {
      const secure = c.req.header("host") === share.host;
      setCookie(c, `prg_guest_${port()}`, people.issue(person), { httpOnly: true, sameSite: "Strict", path: "/", secure });
      // The owner's Share popover lists who is signed in.
      store.notify("session");
    }
    return c.json(status);
  });

  return app;
}
