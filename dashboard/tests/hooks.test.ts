import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { trimInput } from "../scripts/dashboards.mjs";

const scripts = join(import.meta.dir, "..", "scripts");
const SESSION = "sess-1";

type Call = { method: string; path: string; auth: string | null; body: unknown };
type Stub = { calls: Call[]; origin: string; stop: () => void };

let home: string;
let stubs: Stub[] = [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "prg-hooks-"));
  mkdirSync(join(home, ".cache", "prg"), { recursive: true });
});
afterEach(() => {
  for (const stub of stubs) {
    stub.stop();
  }
  stubs = [];
  rmSync(home, { recursive: true, force: true });
});

// A dashboard that records what it is sent and answers wait with the next state it was given.
function stub(states: string[] = ["allow"], token = "tok") {
  const calls: Call[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const text = await request.text();
      calls.push({ method: request.method, path, auth: request.headers.get("authorization"), body: text ? JSON.parse(text) : null });
      if (path === "/api/permissions" && request.method === "POST") {
        return Response.json({ id: "p1" });
      }
      if (path.endsWith("/wait")) {
        const state = states.shift() ?? "dropped";
        if (state === "error") {
          return new Response("broken", { status: 500 });
        }
        if (state === "slow") {
          await Bun.sleep(3000);
          return Response.json({ state: "waiting" });
        }
        return Response.json({ state });
      }
      return Response.json({});
    },
  });
  const made: Stub = { calls, origin: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
  stubs.push(made);
  writeFileSync(
    join(home, ".cache", "prg", `${server.port}.json`),
    JSON.stringify({ session: SESSION, origin: made.origin, token, pid: process.pid }),
  );
  return made;
}

async function runHook(command: string[], input: object, extra: Record<string, string> = {}) {
  const proc = Bun.spawn(command, {
    stdin: new Blob([JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: home, ...extra, PATH: `${dirname(process.execPath)}:${process.env.PATH}` },
  });
  const out = await new Response(proc.stdout).text();
  return { out, code: await proc.exited };
}

const permission = (input: object) => runHook(["bun", join(scripts, "permission.mjs")], { session_id: SESSION, ...input });
const attention = (mode: string, input: object) =>
  runHook(["bun", join(scripts, "attention.mjs"), mode], { session_id: SESSION, ...input });
const bash = { tool_name: "Bash", tool_input: { command: "ls" } };
const marker = () => join(home, ".cache", "prg", "waiting", SESSION);

describe("permission.mjs", () => {
  test("exits at once with no output when no dashboard matches the session", async () => {
    const result = await permission(bash);
    expect(result).toEqual({ out: "", code: 0 });
  });

  test("posts nothing when the shown field is over 2,000 characters", async () => {
    const dashboard = stub(["allow"]);
    const result = await permission({ tool_name: "Bash", tool_input: { command: "x".repeat(2001) } });
    expect(result).toEqual({ out: "", code: 0 });
    expect(dashboard.calls).toEqual([]);
    expect(existsSync(marker())).toBe(false);
  });

  test("prints allow when the dashboard answers allow", async () => {
    const dashboard = stub(["allow"]);
    const result = await permission(bash);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
    expect(dashboard.calls[0]).toMatchObject({
      method: "POST",
      path: "/api/permissions",
      auth: "Bearer tok",
      body: { tool: "Bash", input: bash.tool_input },
    });
    expect(readFileSync(marker(), "utf8")).toContain("Bash");
  });

  test("prints deny with the message", async () => {
    stub(["deny"]);
    const result = await permission(bash);
    expect(JSON.parse(result.out).hookSpecificOutput.decision).toEqual({
      behavior: "deny",
      message: "The owner denied this from the review page.",
    });
  });

  test("exits with no output when its request is dropped", async () => {
    stub(["dropped"]);
    expect(await permission(bash)).toEqual({ out: "", code: 0 });
  });

  test("ignores AskUserQuestion and ExitPlanMode without calling the dashboard", async () => {
    const dashboard = stub(["allow"]);
    for (const tool_name of ["AskUserQuestion", "ExitPlanMode"]) {
      expect(await permission({ tool_name, tool_input: {} })).toEqual({ out: "", code: 0 });
    }
    expect(dashboard.calls).toEqual([]);
  });

  test("carries on when one of two dashboards fails", async () => {
    const first = stub(["error"], "a");
    const second = stub(["allow"], "b");
    const result = await permission(bash);
    expect(JSON.parse(result.out).hookSpecificOutput.decision.behavior).toBe("allow");
    expect(first.calls.some(c => c.path.endsWith("/wait"))).toBe(true);
    expect(second.calls.some(c => c.path.endsWith("/wait"))).toBe(true);
  });

  test("waits on every dashboard at once, so the second answering is prompt", async () => {
    stub(["slow"], "a");
    stub(["allow"], "b");
    const started = Date.now();
    const result = await permission(bash);
    expect(JSON.parse(result.out).hookSpecificOutput.decision.behavior).toBe("allow");
    expect(Date.now() - started).toBeLessThan(2500);
  });

  test("deletes its request from the dashboards that did not answer", async () => {
    const first = stub(["slow"], "a");
    const second = stub(["allow"], "b");
    await permission(bash);
    expect(first.calls.some(c => c.method === "DELETE" && c.path === "/api/permissions/p1")).toBe(true);
    expect(second.calls.some(c => c.method === "DELETE")).toBe(true);
  });

  test("gives up at its deadline and deletes the request from every dashboard", async () => {
    const first = stub(["waiting"], "a");
    const second = stub(["waiting"], "b");
    const result = await runHook(
      ["bun", join(scripts, "permission.mjs")],
      { session_id: SESSION, ...bash },
      { PRG_PERMISSION_LIMIT_MS: "0" },
    );
    expect(result.out).toBe("");
    for (const dashboard of [first, second]) {
      expect(dashboard.calls.some(c => c.method === "DELETE" && c.path === "/api/permissions/p1")).toBe(true);
    }
  });

  test("ignores a state file left by a dashboard that has died, whatever now answers on its port", async () => {
    const gone = Bun.spawn(["true"]);
    await gone.exited;
    const squatter = stub();
    const file = join(home, ".cache", "prg", `${new URL(squatter.origin).port}.json`);
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), pid: gone.pid }));
    const result = await permission(bash);
    expect(result.out).toBe("");
    expect(squatter.calls).toEqual([]);
  });

  test("writes its marker line before the request is posted", async () => {
    const seen = Promise.withResolvers<string | null>();
    const server = Bun.serve({
      port: 0,
      fetch() {
        seen.resolve(existsSync(marker()) ? readFileSync(marker(), "utf8") : null);
        return Response.json({ id: "p1" });
      },
    });
    writeFileSync(
      join(home, ".cache", "prg", "x.json"),
      JSON.stringify({ session: SESSION, origin: `http://127.0.0.1:${server.port}`, token: "t", pid: process.pid }),
    );
    await permission(bash);
    server.stop(true);
    expect(await seen.promise).toBe("Bash\n");
  });
});

describe("attention.mjs", () => {
  test("clear sends the tool and input to /api/permissions/clear, and with no tool sends {}", async () => {
    const dashboard = stub();
    await attention("clear", bash);
    await attention("clear", {});
    const clears = dashboard.calls.filter(c => c.path === "/api/permissions/clear");
    expect(clears.map(c => c.body)).toEqual([{ tool: "Bash", input: { command: "ls" } }, {}]);
  });

  test("a tool's clear keeps the marker, and a clear with no tool removes it", async () => {
    stub();
    mkdirSync(join(home, ".cache", "prg", "waiting"), { recursive: true });
    writeFileSync(marker(), "Bash\nWrite\n");
    await attention("clear", bash);
    expect(readFileSync(marker(), "utf8")).toBe("Bash\nWrite\n");
    await attention("clear", {});
    expect(existsSync(marker())).toBe(false);
  });

  test("a same-name clear for another input leaves the marker, so the matching clear still goes out", async () => {
    const dashboard = stub();
    mkdirSync(join(home, ".cache", "prg", "waiting"), { recursive: true });
    writeFileSync(marker(), "WebFetch\n");
    const clear = (url: string) =>
      runHook(["sh", join(scripts, "attention.sh"), "clear"], { session_id: SESSION, tool_name: "WebFetch", tool_input: { url } });
    await clear("https://allowed.test");
    await clear("https://b.test");
    expect(dashboard.calls.filter(c => c.path === "/api/permissions/clear").map(c => c.body)).toEqual([
      { tool: "WebFetch", input: { url: "https://allowed.test" } },
      { tool: "WebFetch", input: { url: "https://b.test" } },
    ]);
    expect(readFileSync(marker(), "utf8")).toBe("WebFetch\n");
  });
});

describe("both scripts", () => {
  test("a Write with a long content is trimmed the same way by both", async () => {
    const dashboard = stub(["allow"]);
    const write = {
      tool_name: "Write",
      tool_input: { file_path: "a.txt", content: "x".repeat(5000), nested: { more: ["y".repeat(3000)] } },
    };
    await permission(write);
    await attention("clear", write);
    const posted = dashboard.calls.find(c => c.path === "/api/permissions")?.body as { input: unknown };
    const cleared = dashboard.calls.find(c => c.path === "/api/permissions/clear")?.body as { input: unknown };
    expect(cleared.input).toEqual(posted.input);
    expect(JSON.stringify(posted.input).length).toBeLessThan(4200);
  });

  test("trimInput cuts long strings at any depth and keeps short ones", () => {
    const out = trimInput({ a: "x".repeat(2001), b: ["y".repeat(2000), { c: "z".repeat(2500) }], n: 3 }) as {
      a: string;
      b: [string, { c: string }];
      n: number;
    };
    expect(out.a).toBe(`${"x".repeat(2000)}…`);
    expect(out.b[0]).toBe("y".repeat(2000));
    expect(out.b[1].c).toBe(`${"z".repeat(2000)}…`);
    expect(out.n).toBe(3);
  });
});

describe("attention.sh", () => {
  test("skips the clear for a tool not in the marker, and runs it for one that is", async () => {
    const dashboard = stub();
    mkdirSync(join(home, ".cache", "prg", "waiting"), { recursive: true });
    writeFileSync(marker(), "Write\n");
    const run = () => runHook(["sh", join(scripts, "attention.sh"), "clear"], { session_id: SESSION, ...bash });
    await run();
    expect(dashboard.calls).toEqual([]);
    writeFileSync(marker(), "Write\nBash\n");
    await run();
    expect(dashboard.calls.some(c => c.path === "/api/permissions/clear")).toBe(true);
  });

  test("reads the hook's own session and tool when the tool's input has fields of the same names", async () => {
    const dashboard = stub();
    mkdirSync(join(home, ".cache", "prg", "waiting"), { recursive: true });
    writeFileSync(marker(), "Bash\n");
    const input = { session_id: SESSION, tool_name: "Bash", tool_input: { session_id: "other", tool_name: "Write" } };
    await runHook(["sh", join(scripts, "attention.sh"), "clear"], input);
    expect(dashboard.calls.some(c => c.path === "/api/permissions/clear")).toBe(true);
  });
});
