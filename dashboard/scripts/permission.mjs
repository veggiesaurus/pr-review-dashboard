// Holds a permission prompt open on the dashboards while the owner may answer it on the page, and prints their answer.
// Run by the plugin's hook through permission.sh; with no answer it prints nothing and the terminal's dialog stands.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { cacheDir, dashboardsFor, trimInput } from "./dashboards.mjs";

const SKIPPED = ["AskUserQuestion", "ExitPlanMode"];
const LIMIT_MS = Number(process.env.PRG_PERMISSION_LIMIT_MS ?? 59 * 60 * 1000);

async function main() {
  const input = JSON.parse((await Bun.stdin.text()) || "{}");
  const session = typeof input.session_id === "string" && /^[\w-]{1,100}$/.test(input.session_id) ? input.session_id : null;
  const tool = input.tool_name;
  if (!session || typeof tool !== "string" || !tool || SKIPPED.includes(tool)) {
    return;
  }
  const shown = ["command", "file_path", "notebook_path", "url"].map(key => input.tool_input?.[key]);
  // A field cut for the page can't be read in full there, so the terminal answers it.
  if (shown.some(value => typeof value === "string" && value.length > 2000)) {
    return;
  }
  const deadline = Date.now() + LIMIT_MS;
  const body = JSON.stringify({ tool, input: trimInput(input.tool_input ?? {}), deadline: new Date(deadline).toISOString() });

  const call = (dashboard, path, init = {}, ms = 2000, signal = undefined) =>
    fetch(`${dashboard.origin}/api/permissions${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${dashboard.token}`, "content-type": "application/json" },
      signal: AbortSignal.any([AbortSignal.timeout(ms), ...(signal ? [signal] : [])]),
    });

  const dashboards = dashboardsFor(session);
  if (dashboards.length === 0) {
    return;
  }

  // Written before the request, so a clear that runs right after the tool can never miss it.
  const dir = join(cacheDir(), "waiting");
  const marker = join(dir, session);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!(existsSync(marker) && readFileSync(marker, "utf8").split("\n").includes(tool))) {
    appendFileSync(marker, `${tool}\n`);
  }

  const held = (
    await Promise.all(
      dashboards.map(async dashboard => {
        try {
          const response = await call(dashboard, "", { method: "POST", body });
          return response.ok ? { dashboard, id: (await response.json()).id } : null;
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean);

  let decision = null;
  const stop = new AbortController();
  // Each dashboard is waited on at once and the first answer wins; every request is deleted on the way out.
  const watch = async entry => {
    while (!stop.signal.aborted && Date.now() < deadline) {
      try {
        const response = await call(entry.dashboard, `/${entry.id}/wait`, {}, 30_000, stop.signal);
        const { state } = await response.json();
        if (state === "allow" || state === "deny") {
          decision ??=
            state === "allow" ? { behavior: "allow" } : { behavior: "deny", message: "The owner denied this from the review page." };
          stop.abort();
          return;
        }
        if (state !== "waiting") {
          break;
        }
      } catch {
        break;
      }
    }
  };
  try {
    await Promise.all(held.map(watch));
  } finally {
    await Promise.all(held.map(entry => call(entry.dashboard, `/${entry.id}`, { method: "DELETE" }).catch(() => {})));
  }
  if (decision) {
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } })}\n`);
  }
}

await main().catch(() => {});
process.exit(0);
