import { timingSafeEqual } from "node:crypto";
import { resolve, sep } from "node:path";

import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { IMAGE_ID } from "../shared/messages";
import type { Runner } from "./comments";
import type { Env } from "./guards";
import type { People } from "./people";
import type { Review } from "./review";
import { attachmentsRoutes } from "./routes/attachments";
import { commentsRoutes } from "./routes/comments";
import { fontsRoutes } from "./routes/fonts";
import { githubRoutes } from "./routes/github";
import { linearRoutes } from "./routes/linear";
import { messagesRoutes } from "./routes/messages";
import { reviewRoutes } from "./routes/review";
import { reviewsRoutes } from "./routes/reviews";
import { shareRoutes } from "./routes/share";
import { ticksRoutes } from "./routes/ticks";
import { usagesRoutes } from "./routes/usages";
import type { Share } from "./share";
import type { Store } from "./store";

export type AppDeps = {
  store: Store;
  review: Review;
  // Three secrets, so each holder can only be what it is: the session's bearer token, the code in the link it
  // gives the user, which the page sends with every call, and a cookie that by itself only gets the page's files.
  token: string;
  linkCode: string;
  cookieSecret: string;
  people: People;
  share: Share;
  // The code in the share link guests send as their key; null while not sharing, which shuts every guest out.
  guestCode: () => string | null;
  port: () => number;
  // Started with --host: an address of this machine the page may also be reached on, such as its Wi-Fi address for a phone.
  host?: string;
  repo: string;
  staticDir: string;
  // Where screenshots dropped into the chat are kept.
  attachments: string;
  linearKey?: string;
  fetcher?: typeof fetch;
  // gh and git go through this, so tests can stand in for them.
  runner?: Runner;
  // Started with --github-comments: the page may post notes to the pull request as a review.
  githubComments?: boolean;
  onActivity?: () => void;
  onShutdown?: () => void;
};

// What a cookie gets with no key: pictures and font files, which an <img> or a stylesheet asks for and can't put a header on.
// A screenshot's name is the hash of its content, so it can't be guessed.
const PICTURE = new RegExp(
  `^/api/(?:(?:github|linear/[^/]+|layers/\\d+/comments)/avatar/[^/]+|fonts/file/[\\w/.-]+|attachments/${IMAGE_ID.source.slice(1, -1)})$`,
);

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createApp(deps: AppDeps) {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    const port = deps.port();
    // The tunnel's host, while sharing, is the only one reached over https, and has no port.
    const tunnel = deps.share.host;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...(deps.host ? [`${deps.host}:${port}`] : []), ...(tunnel ? [tunnel] : [])];
    const origins = hosts.map(h => (h === tunnel ? `https://${h}` : `http://${h}`));
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${origins.map(o => o.replace("http", "ws")).join(" ")}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );

    // A page on another site can reach a loopback port, so the name it used and the page it came from are both checked.
    const host = c.req.header("host") ?? "";
    if (!hosts.includes(host)) {
      return c.text("forbidden\n", 403);
    }
    const onTunnel = host === tunnel;
    const origin = c.req.header("origin");
    if (origin && !origins.includes(origin)) {
      return c.text("forbidden\n", 403);
    }

    const url = new URL(c.req.url);
    // The path as the router decodes it: /%61pi/review routes to /api/review, so the raw one can't decide who may call.
    const path = c.req.path;
    const code = url.searchParams.get("t");
    const cookieName = `prg_${port}`;
    const opening = c.req.method === "GET" && path === "/" && code !== null;
    if (opening) {
      if (!safeEqual(code, deps.linkCode)) {
        return c.text("unauthorised\n", 401);
      }
      setCookie(c, cookieName, deps.cookieSecret, { httpOnly: true, sameSite: "Strict", path: "/", secure: onTunnel });
    }

    // Monitor's ws source and the browser's WebSocket can't set a header, so those two sockets alone carry theirs in the query.
    const bearer = c.req.header("authorization")?.replace(/^Bearer /, "") ?? (path === "/api/session/ws" ? code : null);
    const key = c.req.header("x-prg-key") ?? (path === "/api/ws" ? url.searchParams.get("k") : null);
    const cookie = getCookie(c, cookieName);
    const owner = opening || Boolean(cookie && safeEqual(cookie, deps.cookieSecret));
    const guestCode = deps.guestCode();
    const guestSession = getCookie(c, `prg_guest_${port}`);
    const guest = guestCode !== null && guestSession ? deps.people.find(guestSession) : null;
    // The session is on this machine, so its token is no use from the tunnel.
    if (bearer && !onTunnel && safeEqual(bearer, deps.token)) {
      c.set("who", "session");
      c.set("author", null);
    } else if (owner || guest) {
      // Browsers send Origin on every write and every socket, so a cookie request without one isn't from the page.
      const needsOrigin = !["GET", "HEAD"].includes(c.req.method) || path === "/api/ws";
      if (needsOrigin && !origin) {
        return c.text("forbidden\n", 403);
      }
      // A cookie goes to every port on this host, so another local server can end up holding it. The key lives in
      // the page's own storage, which is per port, and the API wants both.
      const open = c.req.method === "GET" && (!path.startsWith("/api/") || PICTURE.test(path));
      const keyIs = (expected: string) => open || Boolean(key && safeEqual(key, expected));
      if (owner && keyIs(deps.linkCode)) {
        c.set("who", "owner");
        c.set("author", deps.people.owner && { ...deps.people.owner, role: "owner" });
      } else if (guest && guestCode !== null && keyIs(guestCode)) {
        c.set("who", "guest");
        c.set("author", { ...guest, role: "guest" });
      } else {
        return c.text("unauthorised: open the link your Claude session gave you\n", 401);
      }
    } else {
      return c.text("unauthorised: open the link your Claude session gave you\n", 401);
    }
    // Only a caller with a credential keeps the server from stopping when idle.
    deps.onActivity?.();
    await next();
  });

  app.route("/api", reviewRoutes(deps));
  app.route("/api", githubRoutes(deps));
  app.route("/api", linearRoutes(deps));
  app.route("/api", messagesRoutes(deps));
  app.route("/api", ticksRoutes(deps));
  app.route("/api", reviewsRoutes(deps));
  app.route("/api", usagesRoutes(deps));
  app.route("/api", commentsRoutes(deps));
  app.route("/api", fontsRoutes(deps));
  app.route("/api", attachmentsRoutes(deps));
  app.route("/api", shareRoutes(deps));
  deps.review.onChange(() => deps.store.notify("review"));

  app.all("/api/*", c => c.json({ error: "not found" }, 404));

  app.get("*", async c => {
    const path = resolve(deps.staticDir, c.req.path === "/" ? "index.html" : `.${c.req.path}`);
    const file = path.startsWith(deps.staticDir + sep) ? Bun.file(path) : null;
    if (!file || !(await file.exists())) {
      return c.text("not found\n", 404);
    }
    return c.body(await file.arrayBuffer(), 200, { "Content-Type": file.type });
  });

  return app;
}
