import { Hono } from "hono";

import type { ReviewResponse } from "../../shared/payload";
import type { AppDeps } from "../app";
import { run } from "../exec";
import { type Env, findLayer, only } from "../guards";
import { localChanges } from "../local";

const MAX_LINES = 2000;

export function reviewRoutes(deps: AppDeps) {
  const { review } = deps;
  const app = new Hono<Env>();

  app.get("/review", c => {
    const body: ReviewResponse = { ...review.response, linear: Boolean(deps.linearKey) };
    return c.json(body);
  });

  // The session asks for this after it rebuilds the review on disk; the page hears about it over its socket.
  app.post("/reload", only("session"), async c => {
    const result = await review.reload();
    if (!result.ok) {
      return c.json({ error: result.error }, 422);
    }
    const { layers, renderError } = review.response;
    return c.json({ ok: true, layers: layers.length, files: layers.reduce((n, layer) => n + layer.files.length, 0), renderError });
  });

  // What the checkout of this layer's branch has that the reviewed head doesn't, for the page to draw in place.
  app.get("/layers/:layer/local", async c => {
    const layer = findLayer(review, c.req.param("layer"));
    return layer ? c.json(await localChanges(deps.runner ?? run, deps.repo, layer)) : c.json({ error: "no such layer" }, 404);
  });

  // Lines of the new file the diff doesn't show, from to to inclusive, 1-based.
  app.get("/layers/:layer/files/:file/lines", c => {
    const layer = findLayer(review, c.req.param("layer"));
    const file = layer?.files.find(f => f.id === c.req.param("file"));
    const text = layer && file ? review.text(layer.id, file.id) : undefined;
    if (!layer || !file || !text || file.lineCount === null) {
      return c.json({ error: "the server doesn't hold that file's text" }, 404);
    }
    const from = Number(c.req.query("from"));
    const asked = Number(c.req.query("to"));
    const to = Math.min(asked, file.lineCount);
    if (!Number.isInteger(from) || !Number.isInteger(asked) || from < 1 || to < from || asked - from >= MAX_LINES) {
      return c.json({ error: `ask for 1 to ${MAX_LINES} lines between 1 and ${file.lineCount}` }, 400);
    }
    return c.json({ from, to, lines: text.slice(from - 1, to) });
  });

  app.post("/shutdown", only("session"), c => {
    setTimeout(() => deps.onShutdown?.(), 50);
    return c.json({ ok: true });
  });

  return app;
}
