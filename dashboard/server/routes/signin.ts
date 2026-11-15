import { Hono } from "hono";
import { setCookie } from "hono/cookie";

import type { AppDeps } from "../app";
import type { Env } from "../guards";

// Reached with the share link alone, before its holder is anyone.
export function signinRoutes({ signIn, people, share, port, store }: AppDeps) {
  const app = new Hono<Env>();

  app.post("/signin", async c => c.json(await signIn.start()));

  app.get("/signin/:id", c => {
    const status = signIn.status(c.req.param("id"));
    if (!status) {
      return c.json({ error: "no sign-in with that id" }, 404);
    }
    if (status.state === "done") {
      const secure = c.req.header("host") === share.host;
      setCookie(c, `prg_guest_${port()}`, people.issue(status.person), { httpOnly: true, sameSite: "Strict", path: "/", secure });
      // The owner's Share popover lists who is signed in.
      store.notify("session");
    }
    return c.json(status);
  });

  return app;
}
