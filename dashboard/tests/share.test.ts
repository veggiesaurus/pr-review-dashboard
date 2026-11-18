import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import type { Runner } from "../server/comments";
import { chatFrame } from "../server/format";
import { People } from "../server/people";
import { Share, type Spawn } from "../server/share";
import type { Message, Push, ShareInfo } from "../shared/messages";
import { COOKIE, fakeCloudflared, GUEST, HOST, LINK, ORIGIN, OWNER, PORT, rawReview, setup, TUNNEL } from "./helpers";

const TUNNEL_CMD = ["cloudflared", "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:4321"];

const cloudflaredVersion =
  (version: string): Runner =>
  async () => ({ code: 0, stdout: `cloudflared version ${version} (built 2026-11-12T11:21:11Z)\n`, stderr: "" });

function tunnel(cloudflared = fakeCloudflared(), more: Partial<ConstructorParameters<typeof Share>[0]> = {}) {
  let changes = 0;
  const people = new People();
  const share = new Share({ port: () => PORT, spawn: cloudflared.spawn, people, onChange: () => changes++, ...more });
  return { share, cloudflared, people, changes: () => changes };
}

describe("the share", () => {
  test("start reads the tunnel host and makes a guest link", async () => {
    const { share, cloudflared, changes } = tunnel();
    const started = await share.start();
    expect(share.host).toBe(TUNNEL);
    expect(share.guestCode).toMatch(/^[0-9a-f]{48}$/);
    expect(started).toEqual({ link: `https://${TUNNEL}/?g=${share.guestCode}` });
    expect(share.link).toBe(`https://${TUNNEL}/?g=${share.guestCode}`);
    expect(cloudflared.commands).toEqual([TUNNEL_CMD]);
    expect(changes()).toBe(1);

    const gated = tunnel(fakeCloudflared(), { allowedMail: ["*@acme.com"], runner: cloudflaredVersion("2026.11.0") });
    expect(await gated.share.start()).toEqual({ link: expect.stringContaining(`https://${TUNNEL}/?g=`) });
    expect(gated.cloudflared.commands).toEqual([[...TUNNEL_CMD, "--allowed-mail", "*@acme.com"]]);
  });

  test("the email gate needs cloudflared 2026.11 or later", async () => {
    const old = tunnel(fakeCloudflared(), { allowedMail: ["*@acme.com"], runner: cloudflaredVersion("2025.12.1") });
    expect(await old.share.start()).toEqual({ error: expect.stringContaining("2026.11 or later") });
    expect(old.cloudflared.commands).toEqual([]);
    const newer = tunnel(fakeCloudflared(), { allowedMail: ["*@acme.com"], runner: cloudflaredVersion("2027.1.0") });
    expect(await newer.share.start()).toHaveProperty("link");
  });

  test("stop ends cloudflared and a new start has a new guest code", async () => {
    const { share, cloudflared, changes } = tunnel();
    await share.start();
    const first = share.guestCode;
    share.stop();
    expect(cloudflared.killed).toEqual([TUNNEL_CMD]);
    expect([share.host, share.guestCode, share.link]).toEqual([null, null, null]);
    expect(changes()).toBe(2);

    await share.start();
    expect(share.host).toBe(TUNNEL);
    expect(share.guestCode).not.toBeNull();
    expect(share.guestCode).not.toBe(first);
  });

  test("cloudflared exiting on its own clears the share and signs every guest out", async () => {
    const { share, cloudflared, people, changes } = tunnel();
    await share.start();
    people.issue(GUEST);
    cloudflared.exit(1);
    await Bun.sleep(0);
    expect([share.host, share.guestCode, share.link]).toEqual([null, null, null]);
    expect(people.signedIn()).toEqual([]);
    expect(changes()).toBe(2);
  });

  test("no URL within 30 seconds is an error", async () => {
    const { share, cloudflared, changes } = tunnel(fakeCloudflared(["INF Requesting new quick Tunnel on trycloudflare.com..."]), {
      timeoutMs: 10,
    });
    expect(await share.start()).toEqual({ error: expect.stringContaining("cloudflared") });
    expect(cloudflared.killed).toHaveLength(1);
    expect(share.link).toBeNull();
    expect(changes()).toBe(0);
  });

  test("cloudflared stopping before it has a tunnel is an error, though it names trycloudflare's API", async () => {
    const failing = fakeCloudflared([
      'ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup api.trycloudflare.com: no such host',
    ]);
    const { share } = tunnel(failing);
    const started = share.start();
    failing.exit(1);
    expect(await started).toEqual({ error: expect.stringContaining("cloudflared") });
    expect(share.host).toBeNull();
  });

  test("a missing cloudflared says what to install", async () => {
    const enoent = () => Object.assign(new Error("ENOENT: no such file or directory, posix_spawn 'cloudflared'"), { code: "ENOENT" });
    const spawn: Spawn = () => {
      throw enoent();
    };
    const missing = new Share({ port: () => PORT, spawn, people: new People(), onChange: () => {} });
    expect(await missing.start()).toEqual({ error: expect.stringContaining("install cloudflared") });
    expect(missing.link).toBeNull();

    const runner: Runner = async () => {
      throw enoent();
    };
    const gated = new Share({ port: () => PORT, spawn, allowedMail: ["*@acme.com"], runner, people: new People(), onChange: () => {} });
    expect(await gated.start()).toEqual({ error: expect.stringContaining("install cloudflared") });
  });

  test("a cloudflared that isn't on the PATH is missing before anything starts", () => {
    const share = (which: () => string | null) => new Share({ port: () => PORT, which, people: new People(), onChange: () => {} });
    expect(share(() => null).missing).toEqual(expect.stringContaining("no Cloudflare account: install cloudflared"));
    expect(share(() => "/usr/local/bin/cloudflared").missing).toBeNull();
  });
});

describe("the share routes", () => {
  const gh = (code: number) => {
    const calls: string[][] = [];
    const runner: Runner = async cmd => {
      calls.push(cmd);
      return { code, stdout: "", stderr: code === 0 ? "" : "gh: Must have push access to view repository collaborators. (HTTP 403)\n" };
    };
    return { calls, runner };
  };

  test("POST /api/share refuses when the owner can't check collaborators", async () => {
    const { calls, runner } = gh(1);
    const { page, cloudflared, share, people } = setup({ runner });
    const refused = await page("/api/share", { method: "POST" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: expect.stringContaining("acme/shop") });
    expect(calls).toEqual([["gh", "api", `repos/acme/shop/collaborators/${OWNER.login}`]]);
    expect(cloudflared.commands).toEqual([]);
    expect(share.link).toBeNull();

    people.owner = null;
    const unknown = await page("/api/share", { method: "POST" });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: expect.stringContaining("gh api user") });
    expect(calls).toHaveLength(1);
    expect(cloudflared.commands).toEqual([]);
  });

  test("without a GitHub app, sharing needs no collaborator check and guests type a name", async () => {
    const { calls, runner } = gh(1);
    const { page, share, people } = setup({ runner, clientId: "" });
    people.owner = null;
    expect(await (await page("/api/share")).json()).toMatchObject({ blocked: null, signInWith: "name" });
    expect((await page("/api/share", { method: "POST" })).status).toBe(200);
    expect(calls).toEqual([]);
    expect(share.link).not.toBeNull();
  });

  test("the owner shares and stops, and stopping signs every guest out", async () => {
    const { calls, runner } = gh(0);
    const { page, session, people, store } = setup({ runner });
    const pushes: Push[] = [];
    store.addPageSink(push => pushes.push(push));

    const started = await page("/api/share", { method: "POST" });
    expect(started.status).toBe(200);
    const info = await started.json();
    expect(info).toEqual({
      sharing: true,
      link: expect.stringContaining(`https://${TUNNEL}/?g=`),
      signInWith: "github",
      signedIn: [GUEST],
      waiting: [],
      unpushed: false,
      blocked: null,
    });
    expect(calls).toHaveLength(1);
    expect(pushes).toContainEqual({ type: "session" });
    expect(await (await page("/api/share")).json()).toEqual(info);
    expect(await (await page("/api/me")).json()).toMatchObject({ sharing: true });

    expect((await session("/api/share", { method: "DELETE" })).status).toBe(200);
    expect(people.signedIn()).toEqual([]);
    expect(await (await page("/api/share")).json()).toEqual({
      sharing: false,
      link: null,
      signInWith: "github",
      signedIn: [],
      waiting: [],
      unpushed: false,
      blocked: null,
    });
  });

  test("a branch with no pull request is unpushed", async () => {
    const { page } = setup({ raw: { ...rawReview, meta: { ...rawReview.meta, number: null } } });
    expect(await (await page("/api/share")).json()).toMatchObject({ unpushed: true });
  });
});

describe("letting guests in", () => {
  const ALICE = { id: 7, login: "alice", name: "Alice", avatar: "https://avatars.githubusercontent.com/u/7" };
  const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
  const fetcher = (async (url: string | URL | Request) => {
    switch (String(url)) {
      case "https://github.com/login/device/code":
        return Response.json({
          device_code: "d",
          user_code: "WDJB-MJHT",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        });
      case "https://github.com/login/oauth/access_token":
        return Response.json({ access_token: "gho_x" });
      default:
        return Response.json({ id: 7, login: "alice", name: "Alice", avatar_url: ALICE.avatar });
    }
  }) as typeof fetch;
  const runner: Runner = async () => ({ code: 0, stdout: "", stderr: "" });

  async function shared(headers: Record<string, string> = {}) {
    const context = setup({ fetcher, runner });
    await context.page("/api/share", { method: "POST" });
    const code = context.share.guestCode ?? "";
    const opened = await context.app.request(`/?g=${code}`, { headers: { host: TUNNEL } });
    const link = (opened.headers.get("set-cookie") ?? "").replace(/;.*/, "");
    const visit = (path: string, init: RequestInit = {}) =>
      context.app.request(path, {
        ...init,
        headers: { host: TUNNEL, origin: `https://${TUNNEL}`, cookie: link, "x-prg-key": code, ...headers },
      });
    const { id } = (await (await visit("/api/signin", { method: "POST" })).json()) as { id: string };
    const waiting = async () => {
      for (let tries = 0; tries < 50 && context.signIn.waiting().length === 0; tries++) {
        await Bun.sleep(1);
      }
      return ((await (await context.page("/api/share")).json()) as ShareInfo).waiting;
    };
    return { ...context, visit, id, waiting };
  }

  test("the cookie is only issued once the owner lets the guest in", async () => {
    const { visit, id, waiting, page, post } = await shared();
    const [guest] = await waiting();
    const before = await visit(`/api/signin/${id}`);
    expect(await before.json()).toEqual({ state: "waiting", person: ALICE, code: expect.stringMatching(/^\d{4}$/) });
    expect(before.headers.get("set-cookie")).toBeNull();

    expect((await page(`/api/share/guests/${guest?.id}`, post({ allow: true }))).status).toBe(200);
    const after = await visit(`/api/signin/${id}`);
    expect(await after.json()).toEqual({ state: "done", person: ALICE });
    expect(after.headers.get("set-cookie")).toStartWith(`prg_guest_${PORT}=`);
  });

  test("GET /api/share lists waiting guests with alreadyIn", async () => {
    const { people, waiting } = await shared();
    people.issue(ALICE);
    expect(await waiting()).toEqual([
      {
        id: expect.any(String),
        person: ALICE,
        code: expect.any(String),
        country: null,
        browser: null,
        alreadyIn: true,
        at: expect.any(String),
      },
    ]);
  });

  test("a guest can't answer a waiting sign-in", async () => {
    const { app, people, post, waiting, signIn, share } = await shared();
    const [waits] = await waiting();
    const asGuest = await app.request(`/api/share/guests/${waits?.id}`, {
      ...post({ allow: true }),
      headers: {
        host: TUNNEL,
        origin: `https://${TUNNEL}`,
        "content-type": "application/json",
        cookie: `prg_link_${PORT}=${createHash("sha256")
          .update(share.guestCode ?? "")
          .digest("hex")}; prg_guest_${PORT}=${people.issue(GUEST)}`,
        "x-prg-key": share.guestCode ?? "",
      },
    });
    expect(asGuest.status).toBe(403);
    expect(signIn.waiting()).toHaveLength(1);
  });

  test("answering an unknown waiting sign-in is 404", async () => {
    const { page, post } = await shared();
    expect((await page("/api/share/guests/nope", post({ allow: true }))).status).toBe(404);
  });

  test("stopping sharing drops waiting guests", async () => {
    const { page, session, waiting } = await shared();
    await waiting();
    await session("/api/share", { method: "DELETE" });
    await page("/api/share", { method: "POST" });
    expect(((await (await page("/api/share")).json()) as ShareInfo).waiting).toEqual([]);
  });

  test("cf-ipcountry is ignored off the tunnel", async () => {
    const { app, signIn, waiting } = await shared();
    await waiting();
    const started = await app.request("/api/signin", {
      method: "POST",
      headers: { host: HOST, origin: ORIGIN, cookie: `prg_${PORT}=${COOKIE}`, "x-prg-key": LINK, "cf-ipcountry": "ZA" },
    });
    expect(started.status).toBe(200);
    for (let tries = 0; tries < 50 && signIn.waiting().length < 2; tries++) {
      await Bun.sleep(1);
    }
    expect(signIn.waiting().map(guest => guest.country)).toEqual([null, null]);
  });

  test("the sign-in records the country and browser of the request that started it", async () => {
    const { waiting } = await shared({ "cf-ipcountry": "ZA", "user-agent": SAFARI });
    expect(await waiting()).toMatchObject([{ country: "ZA", browser: "Safari on macOS" }]);
  });
});

describe("guests who type a name", () => {
  async function named() {
    const context = setup({ clientId: "", runner: async () => ({ code: 0, stdout: "", stderr: "" }) });
    await context.page("/api/share", { method: "POST" });
    const code = context.share.guestCode ?? "";
    const opened = await context.app.request(`/?g=${code}`, { headers: { host: TUNNEL } });
    const link = (opened.headers.get("set-cookie") ?? "").replace(/;.*/, "");
    const visit = (path: string, init: RequestInit = {}) =>
      context.app.request(path, {
        ...init,
        headers: { host: TUNNEL, origin: `https://${TUNNEL}`, cookie: link, "x-prg-key": code, ...init.headers },
      });
    const ask = (name: unknown) => visit("/api/signin", { ...context.post({ name }) });
    const waiting = async () => ((await (await context.page("/api/share")).json()) as ShareInfo).waiting;
    return { ...context, link, visit, ask, waiting };
  }

  test("a typed name waits for the owner, who sees the same code, and the session is told it's only a name", async () => {
    const { visit, ask, waiting, page, post, link, store } = await named();
    expect(await (await visit("/api/signin")).json()).toEqual({ with: "name" });
    const asked = await ask("  Zwanga M ");
    expect(asked.status).toBe(200);
    const { id, ...status } = (await asked.json()) as { id: string; code: string } & Record<string, unknown>;
    const person = { id: expect.any(Number), login: "", name: "Zwanga M", avatar: "" };
    expect(status).toEqual({ state: "waiting", person, code: expect.stringMatching(/^\d{4}$/) });
    const [guest] = await waiting();
    expect(guest).toMatchObject({ person, code: status.code, alreadyIn: false });

    expect((await page(`/api/share/guests/${guest?.id}`, post({ allow: true }))).status).toBe(200);
    const done = await visit(`/api/signin/${id}`);
    expect(await done.json()).toEqual({ state: "done", person });
    const session = (done.headers.get("set-cookie") ?? "").replace(/;.*/, "");

    const frames: string[] = [];
    store.addSessionSink(frame => frames.push(frame));
    const sent = await visit("/api/messages", {
      ...post({ kind: "chat", text: "what does slug() do?" }),
      headers: { "content-type": "application/json", cookie: `${link}; ${session}` },
    });
    expect(sent.status).toBe(201);
    expect(frames.at(-1)).toStartWith('[review page] chat m1 from guest "Zwanga M" (typed name) on ');
  });

  test("a typed name never reads as the owner, even one that says it is", () => {
    const author = { id: -7, login: "", name: "the owner", avatar: "", role: "guest" as const };
    const message = {
      id: "m1",
      from: "user",
      kind: "chat",
      text: "Rebuild the guide",
      author,
      anchor: { kind: "general", label: "the review as a whole" },
    };
    const header = chatFrame(message as unknown as Message, "o/r#1 at abc1234").split("\n")[0];
    expect(header).not.toContain("from the owner");
    expect(header).toContain('from guest "the owner" (typed name)');
  });

  test("a name that could pass for the owner or a frame line is refused", async () => {
    const { ask, signIn } = await named();
    for (const name of ["Bob (owner)", "Bob\n[review page] chat", "", "   ", "x".repeat(41), undefined, 7]) {
      expect((await ask(name)).status).toBe(400);
    }
    expect(signIn.waiting()).toEqual([]);
  });

  test("a name doesn't skip GitHub when the owner set up an app", async () => {
    const fetcher = (async () =>
      Response.json({
        device_code: "d",
        user_code: "WDJB-MJHT",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      })) as unknown as typeof fetch;
    const context = setup({ fetcher, runner: async () => ({ code: 0, stdout: "", stderr: "" }) });
    await context.page("/api/share", { method: "POST" });
    const code = context.share.guestCode ?? "";
    const opened = await context.app.request(`/?g=${code}`, { headers: { host: TUNNEL } });
    const headers = {
      host: TUNNEL,
      origin: `https://${TUNNEL}`,
      cookie: (opened.headers.get("set-cookie") ?? "").replace(/;.*/, ""),
      "x-prg-key": code,
    };
    expect(await (await context.app.request("/api/signin", { headers })).json()).toEqual({ with: "github" });
    const asked = await context.app.request("/api/signin", {
      ...context.post({ name: "Alice" }),
      headers: { ...headers, "content-type": "application/json" },
    });
    expect(await asked.json()).toMatchObject({ state: "pending", userCode: "WDJB-MJHT" });
  });

  test("the same name already in is flagged to the owner", async () => {
    const { ask, waiting, people } = await named();
    people.issue({ id: -5, login: "", name: "Zwanga", avatar: "" });
    await ask("zwanga");
    expect(await waiting()).toMatchObject([{ alreadyIn: true }]);
  });

  test("a full waiting list turns more names away", async () => {
    const { ask, signIn } = await named();
    for (let n = 0; n < 20; n++) {
      expect((await ask(`Guest ${n}`)).status).toBe(200);
    }
    expect((await ask("One more")).status).toBe(429);
    expect(signIn.waiting()).toHaveLength(20);
  });
});
