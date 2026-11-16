// Tells the dashboards a session started that it waits at a permission prompt (set) or has moved on (clear).
// Run by the plugin's hooks through attention.sh, with the hook's input on stdin.
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { cacheDir, dashboardsFor, trimInput } from "./dashboards.mjs";

const mode = process.argv[2];
const input = JSON.parse((await Bun.stdin.text()) || "{}");
const session = typeof input.session_id === "string" && /^[\w-]{1,100}$/.test(input.session_id) ? input.session_id : null;
if (!session || (mode === "set" && input.notification_type !== "permission_prompt")) {
  process.exit(0);
}

const dir = cacheDir();
const marker = join(dir, "waiting", session);
const text = mode === "set" ? String(input.message || "Claude needs your permission") : "";
const clearedTool = mode === "clear" && typeof input.tool_name === "string" && input.tool_name ? input.tool_name : null;

const states = dashboardsFor(session);
const send = (state, path, body) =>
  fetch(`${state.origin}/api/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});

await Promise.all(
  states.flatMap(state => [
    send(state, "attention", { text }),
    ...(mode === "clear"
      ? [send(state, "permissions/clear", clearedTool ? { tool: clearedTool, input: trimInput(input.tool_input ?? {}) } : {})]
      : []),
  ]),
);

// The marker lets the hook that runs after every tool call skip all of this when nothing is waiting.
if (mode === "set" && states.length > 0) {
  mkdirSync(join(dir, "waiting"), { recursive: true, mode: 0o700 });
  // The tool waiting, so another that runs beside it doesn't clear the warning when it finishes.
  appendFileSync(marker, `${/permission to use (\S+)/.exec(text)?.[1] ?? ""}\n`);
} else if (mode === "clear" && !clearedTool) {
  // Only the end of a turn or a new prompt ends the marker: a tool's clear can't tell which of two like calls it was.
  rmSync(marker, { force: true });
}
