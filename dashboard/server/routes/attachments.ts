import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { IMAGE_ID, IMAGE_TYPES } from "../../shared/messages";
import type { AppDeps } from "../app";
import { type Env, only } from "../guards";

type Kind = keyof typeof IMAGE_TYPES;

// What the bytes are, whatever the browser called them. SVG is left out: it can carry script.
export function imageKind(bytes: Uint8Array): Kind | null {
  const at = (start: number, ...expected: number[]) => expected.every((byte, i) => bytes[start + i] === byte);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "png";
  }
  if (at(0, 0xff, 0xd8, 0xff)) {
    return "jpg";
  }
  if (at(0, 0x47, 0x49, 0x46, 0x38)) {
    return "gif";
  }
  return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50) ? "webp" : null;
}

export const attachmentPath = (dir: string, id: string) => (IMAGE_ID.test(id) ? join(dir, id) : null);

export const hasAttachment = (dir: string, id: string) => {
  const path = attachmentPath(dir, id);
  return path !== null && existsSync(path);
};

// Screenshots the user drops into the chat, kept beside the database. Each is named by its content, so the name
// can't be guessed and the same image is kept once.
export function attachmentsRoutes(deps: AppDeps) {
  const app = new Hono<Env>();

  app.post("/attachments", only("page"), bodyLimit({ maxSize: 10 * 1024 * 1024 }), async c => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const kind = imageKind(bytes);
    if (!kind) {
      return c.json({ error: "only PNG, JPEG, WebP or GIF images can be attached" }, 415);
    }
    const id = `${createHash("sha256").update(bytes).digest("hex")}.${kind}`;
    mkdirSync(deps.attachments, { recursive: true, mode: 0o700 });
    writeFileSync(join(deps.attachments, id), bytes, { mode: 0o600 });
    return c.json({ id }, 201);
  });

  app.get("/attachments/:id", async c => {
    const path = attachmentPath(deps.attachments, c.req.param("id"));
    const file = path ? Bun.file(path) : null;
    if (!path || !file || !(await file.exists())) {
      return c.json({ error: "no such image" }, 404);
    }
    return c.body(await file.arrayBuffer(), 200, {
      "Content-Type": IMAGE_TYPES[path.slice(path.lastIndexOf(".") + 1) as Kind],
      "Cache-Control": "private, max-age=86400, immutable",
    });
  });

  return app;
}
