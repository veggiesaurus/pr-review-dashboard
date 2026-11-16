import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { type PermissionsInfo, permissionAnswerSchema, permissionClearSchema, permissionRequestSchema } from "../../shared/messages";
import type { AppDeps } from "../app";
import { type Env, only, small } from "../guards";

const HOLD_MS = 25_000;

export function permissionsRoutes(deps: AppDeps) {
  const { permissions } = deps;
  const app = new Hono<Env>();

  const info = (answerable: boolean): PermissionsInfo => ({ prompts: permissions.list(), answerable });

  // The hook's own calls first, so "clear" is never read as an id.
  app.post("/permissions/clear", only("session"), small, zValidator("json", permissionClearSchema), c => {
    const { tool, input } = c.req.valid("json");
    permissions.clear(tool, input);
    return c.json({});
  });

  app.post("/permissions", only("session"), small, zValidator("json", permissionRequestSchema), c => {
    const { tool, input, deadline } = c.req.valid("json");
    return c.json({ id: permissions.add(tool, input, deadline) });
  });

  app.get("/permissions/:id/wait", only("session"), async c => c.json({ state: await permissions.wait(c.req.param("id"), HOLD_MS) }));

  app.delete("/permissions/:id", only("session"), c => {
    permissions.drop(c.req.param("id"));
    return c.json({});
  });

  app.get("/permissions", only("owner"), c => c.json(info(!c.get("tunnel"))));

  app.post("/permissions/:id", only("owner"), small, zValidator("json", permissionAnswerSchema), c => {
    if (c.get("tunnel")) {
      return c.json({ error: "answer this on this computer or in the terminal, not through the share link" }, 403);
    }
    if (!permissions.answer(c.req.param("id"), c.req.valid("json").behavior)) {
      return c.json({ error: "that prompt is no longer waiting" }, 409);
    }
    // Whatever the terminal's notification said is answered too.
    deps.store.setAttention("");
    return c.json(info(true));
  });

  return app;
}
