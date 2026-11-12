import { Hono } from "hono";

import type { AppDeps } from "../app";
import type { Env } from "../guards";
import { readUpTo } from "../linear";

// A palette's fonts, fetched from Google Fonts on the page's behalf, so the page itself still loads nothing from
// another host. The two hosts are fixed; the page only chooses a family name or a file path of the shapes below.
const FAMILY = /^[A-Za-z0-9 ]{1,40}$/;
export const FONT_FILE = /^s\/[a-z0-9]+\/v\d+\/[\w-]+\.woff2$/;
const FACE = /@font-face\s*\{([^}]*)\}/g;
const MAX_SHEET = 256 * 1024;
const MAX_FONT = 2 * 1024 * 1024;
// Google sends woff2 split by script to a browser it knows, and one large ttf per weight to anything else.
const AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const field = (body: string, name: string, pattern: RegExp) =>
  pattern.exec(new RegExp(`${name}:\\s*([^;]+)`).exec(body)?.[1]?.trim() ?? "")?.[0];

// Google's stylesheet goes into the page, so each face is rebuilt from the few parts it may have, with the file
// pointed back at this server. Anything else in the sheet is dropped.
export function fontFaces(family: string, sheet: string) {
  const faces: string[] = [];
  for (const [, body = ""] of sheet.matchAll(FACE)) {
    const style = field(body, "font-style", /^(normal|italic)$/);
    const weight = field(body, "font-weight", /^\d{3}( \d{3})?$/);
    const range = field(body, "unicode-range", /^[U+0-9A-Fa-f?, -]+$/);
    const file = /url\(https:\/\/fonts\.gstatic\.com\/([^)\s]+)\)/.exec(body)?.[1];
    if (style && weight && file && FONT_FILE.test(file)) {
      const subset = range ? `unicode-range:${range};` : "";
      faces.push(
        `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:swap;src:url(/api/fonts/file/${file}) format("woff2");${subset}}`,
      );
    }
  }
  return faces.join("\n");
}

async function get(url: string, limit: number, fetcher: typeof fetch) {
  try {
    const response = await fetcher(url, { redirect: "error", headers: { "User-Agent": AGENT }, signal: AbortSignal.timeout(10_000) });
    return response.ok ? { bytes: await readUpTo(response, limit), type: response.headers.get("content-type") ?? "" } : null;
  } catch {
    return null;
  }
}

// The weights the page uses, or the family's one weight when it has no others.
async function sheet(family: string, fetcher: typeof fetch) {
  for (const weights of [":wght@400;500;600;700", ""]) {
    const got = await get(
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}${weights}&display=swap`,
      MAX_SHEET,
      fetcher,
    );
    const faces = got?.bytes ? fontFaces(family, new TextDecoder().decode(got.bytes)) : "";
    if (faces) {
      return faces;
    }
  }
  return null;
}

export function fontsRoutes(deps: AppDeps) {
  const app = new Hono<Env>();
  const fetcher = deps.fetcher ?? fetch;
  const sheets = new Map<string, Promise<string | null>>();
  const files = new Map<string, Promise<ArrayBuffer | null>>();

  // Asks again after a miss, so one bad answer from Google isn't kept for the life of the server.
  async function once<T>(kept: Map<string, Promise<T | null>>, key: string, load: () => Promise<T | null>) {
    const pending = kept.get(key) ?? load();
    kept.set(key, pending);
    const value = await pending;
    if (value === null) {
      kept.delete(key);
    }
    return value;
  }

  app.get("/fonts/css", async c => {
    const family = c.req.query("family") ?? "";
    if (!FAMILY.test(family)) {
      return c.json({ error: "not a font family" }, 400);
    }
    const faces = await once(sheets, family, () => sheet(family, fetcher));
    return faces ? c.body(faces, 200, { "Content-Type": "text/css; charset=utf-8" }) : c.json({ error: "no such font" }, 404);
  });

  app.get("/fonts/file/:path{.+}", async c => {
    const path = c.req.param("path");
    if (!FONT_FILE.test(path)) {
      return c.json({ error: "not a font file" }, 400);
    }
    const bytes = await once(files, path, async () => {
      const got = await get(`https://fonts.gstatic.com/${path}`, MAX_FONT, fetcher);
      return got?.type.startsWith("font/woff2") ? got.bytes : null;
    });
    return bytes
      ? c.body(bytes, 200, { "Content-Type": "font/woff2", "Cache-Control": "private, max-age=86400" })
      : c.json({ error: "no such font" }, 404);
  });

  return app;
}
