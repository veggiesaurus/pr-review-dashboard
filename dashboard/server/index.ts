import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { websocket } from "hono/bun";

import { createApp } from "./app";
import { openDb } from "./db";
import { run } from "./exec";
import { loadReview } from "./load";
import { Review } from "./review";
import { Store } from "./store";

const { values } = parseArgs({
  options: {
    repo: { type: "string", default: "." },
    state: { type: "string" },
    data: { type: "string" },
    scripts: { type: "string" },
    static: { type: "string" },
    "idle-minutes": { type: "string", default: "60" },
    "github-comments": { type: "boolean", default: false },
    host: { type: "string" },
  },
});

if (!values.state || !values.data) {
  console.error(
    "usage: bun run server/index.ts --state FILE --data DIR [--repo DIR] [--scripts DIR] [--static DIR] [--idle-minutes N] [--github-comments] [--host ADDRESS]",
  );
  process.exit(2);
}

// Off unless asked for: the page over plain HTTP on the local network, for a phone. Anyone there who sees the link can use it.
const host = values.host;
if (host !== undefined && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
  console.error("--host takes an IPv4 address of this machine, such as its Wi-Fi address");
  process.exit(2);
}

const statePath = resolve(values.state);
const portPath = statePath.replace(/(\.json)?$/, ".port");
const dataDir = resolve(values.data);
const scriptsDir = resolve(values.scripts ?? resolve(import.meta.dirname, "../../skills/pr-review-dashboard/scripts"));
const staticDir = resolve(values.static ?? resolve(import.meta.dirname, "../build"));
const idleMs = Number(values["idle-minutes"]) * 60_000;
const load = () => loadReview(dataDir, scriptsDir);

let review: Review;
try {
  review = new Review(await load(), load);
} catch (error) {
  console.error(`pr-review-dashboard can't load ${dataDir}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
if (review.response.renderError) {
  console.log(`render.py failed, so the page shows the diff without the guide:\n${review.response.renderError}`);
}

// GitHub's number for the stack, read from its top PR. Without it a thread is still kept with its PR.
async function stackNumber() {
  const { stack, layers } = review.response;
  const top = layers.at(-1)?.meta.number;
  if (!stack || !top) {
    return undefined;
  }
  const result = await run(["gh", "api", `repos/${stack.repo}/pulls/${top}`, "--jq", ".stack.number"], resolve(values.repo));
  const number = Number(result.stdout.trim());
  return result.code === 0 && Number.isInteger(number) && number > 0 ? number : undefined;
}

// Messages and ticks outlive a restart in one database beside the state file, shared by every review kept there.
const store = new Store(review, {
  db: openDb(resolve(dirname(statePath), "prg.db")),
  stack: await stackNumber(),
  repo: resolve(values.repo),
});
const secret = () => randomBytes(24).toString("hex");
const token = secret();
const linkCode = secret();
let lastActivity = Date.now();

function shutdown(reason: string) {
  console.log(`pr-review-dashboard stopping: ${reason}`);
  rmSync(statePath, { force: true });
  process.exit(0);
}

const app = createApp({
  store,
  review,
  token,
  linkCode,
  cookieSecret: secret(),
  port: () => server.port ?? 0,
  host,
  repo: resolve(values.repo),
  staticDir,
  linearKey: process.env.LINEAR_API_KEY,
  githubComments: values["github-comments"],
  onActivity: () => {
    lastActivity = Date.now();
  },
  onShutdown: () => shutdown("asked to"),
});

// Loopback only. idleTimeout is off so the long-poll and the sockets can stay open.
const listen = (port: number) => Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 0, fetch: app.fetch, websocket });

// The port the last run had, when it is still free: a browser keeps the theme and the palette per address, so a
// new port each start would lose them. Otherwise one the OS picks.
function start() {
  const last = existsSync(portPath) ? Number(readFileSync(portPath, "utf8")) : 0;
  if (Number.isInteger(last) && last > 1023 && last < 65536) {
    try {
      return listen(last);
    } catch {
      // Something else has it now.
    }
  }
  return listen(0);
}
const server = start();
writeFileSync(portPath, String(server.port), { mode: 0o600 });

// The same app on the same port at the extra address, when one was asked for.
if (host) {
  Bun.serve({
    hostname: host,
    port: server.port,
    idleTimeout: 0,
    // Each request from the network is logged, without its query, so a phone that can't get in leaves a trace.
    fetch: (request, lan) => {
      console.log(`${lan.requestIP(request)?.address ?? "?"} ${request.method} ${new URL(request.url).pathname}`);
      return app.fetch(request, lan);
    },
    websocket,
  });
}

const origin = `http://127.0.0.1:${server.port}`;
const lanLink = host ? `http://${host}:${server.port}/?t=${linkCode}` : undefined;
writeFileSync(
  statePath,
  JSON.stringify({ port: server.port, token, origin, link: `${origin}/?t=${linkCode}`, lanLink, pid: process.pid }),
  {
    mode: 0o600,
  },
);
chmodSync(statePath, 0o600);
// The secrets stay out of stdout, which ends up in the session's transcript.
console.log(`pr-review-dashboard listening on ${origin}${host ? ` and http://${host}:${server.port}` : ""}, state in ${statePath}`);

setInterval(() => {
  if (!store.connected && Date.now() - lastActivity > idleMs) {
    shutdown(`idle for ${values["idle-minutes"]} minutes`);
  }
}, 30_000);

process.on("SIGINT", () => shutdown("interrupted"));
process.on("SIGTERM", () => shutdown("terminated"));
