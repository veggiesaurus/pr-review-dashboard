// Tells the dashboards a session started that it waits at a permission prompt (set) or has moved on (clear).
// Run by the plugin's hooks through attention.sh, with the hook's input on stdin.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const mode = process.argv[2];
const input = JSON.parse((await Bun.stdin.text()) || "{}");
const session = typeof input.session_id === "string" && /^[\w-]{1,100}$/.test(input.session_id) ? input.session_id : null;
if (!session || (mode === "set" && input.notification_type !== "permission_prompt")) {
  process.exit(0);
}

const dir = join(homedir(), ".cache", "prg");
const marker = join(dir, "waiting", session);
const text = mode === "set" ? String(input.message || "Claude needs your permission") : "";

const states = [];
for (const name of (() => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
})()) {
  if (name.endsWith(".json")) {
    try {
      const state = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (state.session === session && state.origin && state.token) {
        states.push(state);
      }
    } catch {
      // A state file being written, or something else.
    }
  }
}

await Promise.all(
  states.map(state =>
    fetch(`${state.origin}/api/attention`, {
      method: "POST",
      headers: { Authorization: `Bearer ${state.token}`, "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {}),
  ),
);

// The marker lets the hook that runs after every tool call skip all of this when nothing is waiting.
if (mode === "set" && states.length > 0) {
  mkdirSync(join(dir, "waiting"), { recursive: true, mode: 0o700 });
  // The tool waiting, so another that runs beside it doesn't clear the warning when it finishes.
  writeFileSync(marker, /permission to use (\S+)/.exec(text)?.[1] ?? "");
} else if (mode === "clear") {
  rmSync(marker, { force: true });
}
