import { describe, expect, test } from "bun:test";

import { describePrompt, Permissions } from "../server/permissions";
import { GUEST_CODE, setup, TUNNEL } from "./helpers";

const later = () => new Date(Date.now() + 60_000).toISOString();

function made() {
  let now = Date.now();
  let changes = 0;
  const permissions = new Permissions({ onChange: () => changes++, now: () => now });
  return { permissions, changes: () => changes, advance: (ms: number) => (now += ms) };
}

describe("describePrompt", () => {
  test("covers each kind of tool", () => {
    expect(describePrompt("Bash", { command: "ls -la", description: "List files" })).toEqual({
      text: "Claude wants to run",
      code: "ls -la",
      description: "List files",
    });
    expect(describePrompt("Bash", {})).toEqual({ text: "Claude wants to run", code: null, description: null });
    for (const tool of ["Edit", "MultiEdit"]) {
      expect(describePrompt(tool, { file_path: "src/a.ts" })).toEqual({
        text: "Claude wants to edit",
        code: "src/a.ts",
        description: null,
      });
    }
    expect(describePrompt("NotebookEdit", { notebook_path: "n.ipynb" })).toEqual({
      text: "Claude wants to edit",
      code: "n.ipynb",
      description: null,
    });
    expect(describePrompt("Write", { file_path: "src/b.ts", content: "x" })).toEqual({
      text: "Claude wants to write",
      code: "src/b.ts",
      description: null,
    });
    expect(describePrompt("WebFetch", { url: "https://acme.test" })).toEqual({
      text: "Claude wants to fetch",
      code: "https://acme.test",
      description: null,
    });
    expect(describePrompt("mcp__shop__refund", { id: 1 })).toEqual({
      text: "Claude wants to use refund from shop",
      code: null,
      description: null,
    });
    expect(describePrompt("Glob", {})).toEqual({ text: "Claude wants to use Glob", code: null, description: null });
    expect(describePrompt("Write", { file_path: 3 }).code).toBeNull();
  });
});

describe("Permissions", () => {
  test("a request lists until answered, and wait reports the answer once", async () => {
    const { permissions } = made();
    const id = permissions.add("Bash", { command: "ls" }, later());
    expect(permissions.list()).toMatchObject([{ id, text: "Claude wants to run", code: "ls" }]);
    const waiting = permissions.wait(id, 1000);
    expect(permissions.answer(id, "allow")).toBe(true);
    expect(await waiting).toBe("allow");
    expect(permissions.list()).toEqual([]);
    expect(await permissions.wait(id, 10)).toBe("dropped");
    expect(permissions.answer(id, "deny")).toBe(false);
  });

  test("an answer before wait is reported to the next wait", async () => {
    const { permissions } = made();
    const id = permissions.add("Bash", { command: "ls" }, later());
    permissions.answer(id, "deny");
    expect(await permissions.wait(id, 1000)).toBe("deny");
  });

  test('wait resolves "dropped" when the request is cleared or dropped, and for an unknown id', async () => {
    const { permissions } = made();
    const a = permissions.add("Bash", { command: "a" }, later());
    const b = permissions.add("Bash", { command: "b" }, later());
    const first = permissions.wait(a, 1000);
    permissions.drop(a);
    expect(await first).toBe("dropped");
    const second = permissions.wait(b, 1000);
    permissions.clear();
    expect(await second).toBe("dropped");
    expect(await permissions.wait("nope", 10)).toBe("dropped");
  });

  test('wait gives "waiting" after its time with no change', async () => {
    const { permissions } = made();
    const id = permissions.add("Bash", { command: "a" }, later());
    expect(await permissions.wait(id, 20)).toBe("waiting");
    expect(permissions.list()).toHaveLength(1);
  });

  test("clear with tool and input drops only the matching request", () => {
    const { permissions } = made();
    permissions.add("Bash", { command: "a" }, later());
    const keep = permissions.add("Bash", { command: "b" }, later());
    const other = permissions.add("Write", { command: "a" }, later());
    permissions.clear("Bash", { command: "a" });
    expect(permissions.list().map(p => p.id)).toEqual([keep, other]);
  });

  test("clear with nothing drops every request", () => {
    const { permissions } = made();
    permissions.add("Bash", { command: "a" }, later());
    permissions.add("Write", { file_path: "b" }, later());
    permissions.clear();
    expect(permissions.list()).toEqual([]);
  });

  test("lists the oldest first", () => {
    const { permissions } = made();
    const a = permissions.add("Bash", { command: "a" }, later());
    const b = permissions.add("Bash", { command: "b" }, later());
    expect(permissions.list().map(p => p.id)).toEqual([a, b]);
  });

  test('a request past its deadline drops out of the list and its wait says "dropped"', async () => {
    const { permissions, advance } = made();
    const id = permissions.add("Bash", { command: "a" }, new Date(Date.now() + 1000).toISOString());
    advance(2000);
    expect(permissions.list()).toEqual([]);
    expect(await permissions.wait(id, 10)).toBe("dropped");
  });

  test("a lapse tells onChange once, and reading again says nothing", () => {
    const { permissions, changes, advance } = made();
    permissions.add("Bash", { command: "a" }, new Date(Date.now() + 1000).toISOString());
    const before = changes();
    permissions.list();
    expect(changes()).toBe(before);
    advance(2000);
    permissions.list();
    expect(changes()).toBe(before + 1);
    permissions.list();
    expect(changes()).toBe(before + 1);
  });

  test("onChange fires on add, answer, drop and clear", () => {
    const { permissions, changes } = made();
    const a = permissions.add("Bash", { command: "a" }, later());
    expect(changes()).toBe(1);
    permissions.answer(a, "allow");
    expect(changes()).toBe(2);
    const b = permissions.add("Bash", { command: "b" }, later());
    permissions.drop(b);
    expect(changes()).toBe(4);
    permissions.add("Bash", { command: "c" }, later());
    permissions.clear();
    expect(changes()).toBe(6);
  });
});

describe("permission routes", () => {
  const request = { tool: "Bash", input: { command: "ls" }, deadline: later() };

  test("the session can add, wait on, clear and drop a request", async () => {
    const { session, post, page } = setup();
    const { id } = (await (await session("/api/permissions", post(request))).json()) as { id: string };
    await session("/api/permissions/clear", post({ tool: "Bash", input: { command: "ls" } }));
    expect(await (await session(`/api/permissions/${id}/wait`)).json()).toEqual({ state: "dropped" });

    const second = (await (await session("/api/permissions", post(request))).json()) as { id: string };
    expect((await session(`/api/permissions/${second.id}`, { method: "DELETE" })).status).toBe(200);
    expect(((await (await page("/api/permissions")).json()) as { prompts: unknown[] }).prompts).toEqual([]);

    await session("/api/permissions", post(request));
    await session("/api/permissions/clear", post({}));
    expect(((await (await page("/api/permissions")).json()) as { prompts: unknown[] }).prompts).toEqual([]);
  });

  test("the owner lists and answers a request, and the session's wait gets the answer", async () => {
    const { session, page, post } = setup();
    const { id } = (await (await session("/api/permissions", post(request))).json()) as { id: string };
    const listed = (await (await page("/api/permissions")).json()) as { prompts: { id: string; code: string }[]; answerable: boolean };
    expect(listed).toMatchObject({ prompts: [{ id, code: "ls" }], answerable: true });

    const waiting = session(`/api/permissions/${id}/wait`);
    const answered = await page(`/api/permissions/${id}`, post({ behavior: "allow" }));
    expect(answered.status).toBe(200);
    expect(((await answered.json()) as { prompts: unknown[] }).prompts).toEqual([]);
    expect(await (await waiting).json()).toEqual({ state: "allow" });
  });

  test("answering clears what the terminal's notification said", async () => {
    const { session, page, post } = setup();
    void session("/api/session/wait");
    await session("/api/attention", post({ text: "Claude needs your permission to use Bash" }));
    const { id } = (await (await session("/api/permissions", post(request))).json()) as { id: string };
    const attention = async () => ((await (await page("/api/session")).json()) as { attention: unknown }).attention;
    expect(await attention()).not.toBeNull();
    await page(`/api/permissions/${id}`, post({ behavior: "allow" }));
    expect(await attention()).toBeNull();
  });

  test("answering a request that's gone is 409", async () => {
    const { page, post } = setup();
    const response = await page("/api/permissions/nope", post({ behavior: "deny" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toHaveProperty("error");
  });

  test("a guest can neither list nor answer", async () => {
    const { guest, session, post } = setup({ guestCode: () => GUEST_CODE });
    const { id } = (await (await session("/api/permissions", post(request))).json()) as { id: string };
    expect((await guest("/api/permissions")).status).toBe(403);
    expect((await guest(`/api/permissions/${id}`, post({ behavior: "allow" }))).status).toBe(403);
    expect((await guest("/api/permissions", post(request))).status).toBe(403);
  });

  test("on the tunnel the owner sees answerable false, and an answer is 403", async () => {
    const { app, session, post, share } = setup();
    const { id } = (await (await session("/api/permissions", post(request))).json()) as { id: string };
    await share.start();
    expect(share.host).toBe(TUNNEL);
    const headers = { host: TUNNEL, origin: `https://${TUNNEL}`, cookie: `prg_4321=${"c".repeat(48)}`, "x-prg-key": "l".repeat(48) };
    const listed = await app.request("/api/permissions", { headers });
    expect(await listed.json()).toMatchObject({ answerable: false });
    const answered = await app.request(`/api/permissions/${id}`, {
      ...post({ behavior: "allow" }),
      headers: { ...headers, "content-type": "application/json" },
    });
    expect(answered.status).toBe(403);
  });
});
