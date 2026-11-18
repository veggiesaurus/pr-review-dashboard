// What the plugin's hook scripts share: finding this session's dashboards, and cutting long inputs the same way.
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const cacheDir = () => join(homedir(), ".cache", "prg");

// A dashboard that died leaves its file; whatever binds its port later must not get the token or answer prompts.
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export function dashboardsFor(session) {
  const dir = cacheDir();
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    // No dashboard has ever run.
  }
  const found = [];
  for (const name of names.filter(n => n.endsWith(".json"))) {
    try {
      const state = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (state.session === session && state.origin && state.token && Number.isInteger(state.pid) && alive(state.pid)) {
        found.push({ origin: state.origin, token: state.token });
      }
    } catch {
      // A state file being written, or something else.
    }
  }
  return found;
}

// A request and its clear are matched on the input, so both sides must cut it identically.
export function trimInput(input) {
  const cut = value => {
    if (typeof value === "string") {
      return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
    }
    if (Array.isArray(value)) {
      return value.map(cut);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cut(item)]));
    }
    return value;
  };
  return cut(input);
}
