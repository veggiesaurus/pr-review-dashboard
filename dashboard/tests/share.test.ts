import { describe, expect, test } from "bun:test";

import type { Runner } from "../server/comments";
import { People } from "../server/people";
import { Share, type Spawn } from "../server/share";
import type { Push } from "../shared/messages";
import { fakeCloudflared, GUEST, OWNER, PORT, rawReview, setup, TUNNEL } from "./helpers";

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

  test("POST /api/share refuses until a GitHub app is set up for guests to sign in with", async () => {
    const { calls, runner } = gh(0);
    const { page, cloudflared, share } = setup({ runner, clientId: "" });
    const refused = await page("/api/share", { method: "POST" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: expect.stringContaining("PRG_GITHUB_CLIENT_ID") });
    expect(calls).toEqual([]);
    expect(cloudflared.commands).toEqual([]);
    expect(share.link).toBeNull();
  });

  test("the owner shares and stops, and stopping signs every guest out", async () => {
    const { calls, runner } = gh(0);
    const { page, session, people, store } = setup({ runner });
    const pushes: Push[] = [];
    store.addPageSink(push => pushes.push(push));

    const started = await page("/api/share", { method: "POST" });
    expect(started.status).toBe(200);
    const info = await started.json();
    expect(info).toEqual({ sharing: true, link: expect.stringContaining(`https://${TUNNEL}/?g=`), signedIn: [GUEST], unpushed: false });
    expect(calls).toHaveLength(1);
    expect(pushes).toContainEqual({ type: "session" });
    expect(await (await page("/api/share")).json()).toEqual(info);
    expect(await (await page("/api/me")).json()).toMatchObject({ sharing: true });

    expect((await session("/api/share", { method: "DELETE" })).status).toBe(200);
    expect(people.signedIn()).toEqual([]);
    expect(await (await page("/api/share")).json()).toEqual({ sharing: false, link: null, signedIn: [], unpushed: false });
  });

  test("a branch with no pull request is unpushed", async () => {
    const { page } = setup({ raw: { ...rawReview, meta: { ...rawReview.meta, number: null } } });
    expect(await (await page("/api/share")).json()).toMatchObject({ unpushed: true });
  });
});
