import { describe, expect, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";

import type { Runner } from "../server/comments";
import { browserOf, SignIn } from "../server/signin";
import type { Person, Push } from "../shared/messages";
import { GUEST, HOST, PORT, setup, TUNNEL } from "./helpers";

const GITHUB_TOKEN = "gho_n0tAr3alT0kenButSecret";
const ALICE: Person = { id: 7, login: "alice", name: "Alice", avatar: "https://avatars.githubusercontent.com/u/7" };
const DEVICE_CODE = "https://github.com/login/device/code";
const ACCESS_TOKEN = "https://github.com/login/oauth/access_token";
const USER = "https://api.github.com/user";
const CODE = expect.stringMatching(/^\d{4}$/);

// GitHub as the device flow meets it: a code, each poll's answer in turn, then a token and the user it belongs to.
function fakeGithub(polls: object[] = []) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    switch (String(url)) {
      case DEVICE_CODE:
        return Response.json({
          device_code: "device-1",
          user_code: "WDJB-MJHT",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        });
      case ACCESS_TOKEN:
        return Response.json(polls.shift() ?? { access_token: GITHUB_TOKEN, token_type: "bearer", scope: "" });
      case USER:
        return Response.json({ id: 7, login: "alice", name: "Alice", avatar_url: ALICE.avatar, email: null });
      default:
        return new Response("not found", { status: 404 });
    }
  }) as typeof fetch;
  return { fetcher, requests };
}

function collaborator(code: number) {
  const calls: string[][] = [];
  const runner: Runner = async cmd => {
    calls.push(cmd);
    return { code, stdout: "", stderr: code === 0 ? "" : "gh: Not Found (HTTP 404)\n" };
  };
  return { calls, runner };
}

function signingIn(polls: object[] = []) {
  const github = fakeGithub(polls);
  const gh = collaborator(0);
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  const signIn = new SignIn({ clientId: "client-1", fetcher: github.fetcher, runner: gh.runner, repo: () => "acme/shop", sleep });
  return { signIn, github, gh, sleeps };
}

// The poll runs by itself, so a test waits for it to settle.
async function until<T>(read: () => T | Promise<T>, ready: (value: T) => boolean) {
  for (let tries = 0; tries < 50; tries++) {
    const value = await read();
    if (ready(value)) {
      return value;
    }
    await Bun.sleep(1);
  }
  throw new Error("still waiting");
}

const settled = (signIn: SignIn, id: string) =>
  until(
    () => signIn.status(id),
    status => status?.state !== "pending",
  );

describe("GitHub sign-in", () => {
  test("a pending code becomes a signed-in guest", async () => {
    const { signIn, github, gh, sleeps } = signingIn([{ error: "authorization_pending" }, { error: "authorization_pending" }]);
    const started = await signIn.start();
    expect(started).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{48}$/),
      state: "pending",
      userCode: "WDJB-MJHT",
      verificationUri: "https://github.com/login/device",
      expiresAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    });
    expect(await settled(signIn, started.id)).toEqual({ state: "waiting", person: ALICE, code: CODE });
    expect(sleeps).toEqual([5000, 5000, 5000]);

    const sent = (url: string) => github.requests.filter(request => request.url === url).map(request => request.init);
    const [device] = sent(DEVICE_CODE);
    expect(new Headers(device?.headers).get("accept")).toBe("application/json");
    expect(Object.fromEntries(new URLSearchParams(String(device?.body)))).toEqual({ client_id: "client-1" });
    const polls = sent(ACCESS_TOKEN);
    expect(polls).toHaveLength(3);
    expect(Object.fromEntries(new URLSearchParams(String(polls[0]?.body)))).toEqual({
      client_id: "client-1",
      device_code: "device-1",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    const user = new Headers(sent(USER)[0]?.headers);
    expect(user.get("authorization")).toBe(`Bearer ${GITHUB_TOKEN}`);
    expect(user.get("accept")).toBe("application/vnd.github+json");
    expect(user.get("user-agent")).toBe("pr-review-dashboard");
    expect(gh.calls).toEqual([["gh", "api", "repos/acme/shop/collaborators/alice"]]);
  });

  test("slow_down adds five seconds to the interval", async () => {
    const { signIn, sleeps } = signingIn([{ error: "slow_down", interval: 10 }]);
    const { id } = await signIn.start();
    expect(await settled(signIn, id)).toEqual({ state: "waiting", person: ALICE, code: CODE });
    expect(sleeps).toEqual([5000, 10000]);
  });

  test("expired_token and access_denied fail with a reason", async () => {
    const reasons = [
      ["expired_token", "expired"],
      ["access_denied", "denied"],
      ["unsupported_grant_type", "error"],
    ] as const;
    for (const [error, reason] of reasons) {
      const { signIn, gh } = signingIn([{ error }]);
      const { id } = await signIn.start();
      expect(await settled(signIn, id), error).toEqual({ state: "failed", reason });
      expect(gh.calls).toEqual([]);
    }

    const refused = new SignIn({
      clientId: "",
      fetcher: (async () => Response.json({ error: "Not Found" }, { status: 404 })) as unknown as typeof fetch,
      runner: collaborator(0).runner,
      repo: () => "acme/shop",
    });
    const started = await refused.start();
    expect(started).toEqual({ id: expect.any(String), state: "failed", reason: "error" });
    expect(refused.status(started.id)).toEqual({ state: "failed", reason: "error" });
  });
});

describe("the owner letting guests in", () => {
  async function waitingGuest(from = { country: "ZA", browser: "Safari on macOS" }) {
    const context = signingIn();
    const events: string[] = [];
    const signIn = new SignIn({
      clientId: "client-1",
      fetcher: context.github.fetcher,
      runner: context.gh.runner,
      repo: () => "acme/shop",
      sleep: async () => {},
      onChange: () => events.push("change"),
    });
    const { id } = await signIn.start(from);
    await settled(signIn, id);
    await until(
      () => signIn.waiting(),
      list => list.length > 0,
    );
    return { signIn, id, events, handle: signIn.waiting()[0]?.id ?? "" };
  }

  test("a collaborator waits for the owner instead of signing in", async () => {
    const { signIn, id, handle } = await waitingGuest();
    const status = signIn.status(id);
    expect(status).toEqual({ state: "waiting", person: ALICE, code: CODE });
    // The guest's page and the owner's popover show the same code, so the owner can check it with them.
    const code = status?.state === "waiting" ? status.code : "";
    expect(signIn.waiting()).toEqual([
      { id: handle, person: ALICE, code, country: "ZA", browser: "Safari on macOS", at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
    ]);
    expect(handle).not.toBe(id);
  });

  test("letting a guest in finishes the sign-in", async () => {
    const { signIn, id, handle } = await waitingGuest();
    expect(signIn.answer(handle, true)).toBe(true);
    expect(signIn.status(id)).toEqual({ state: "done", person: ALICE });
    expect(signIn.waiting()).toEqual([]);
  });

  test("turning a guest away fails the sign-in", async () => {
    const { signIn, id, handle } = await waitingGuest();
    expect(signIn.answer(handle, false)).toBe(true);
    expect(signIn.status(id)).toEqual({ state: "failed", reason: "turned-away" });
  });

  test("answering an unknown or finished sign-in does nothing", async () => {
    const { signIn, handle } = await waitingGuest();
    expect(signIn.answer("nope", true)).toBe(false);
    expect(signIn.answer(handle, true)).toBe(true);
    expect(signIn.answer(handle, true)).toBe(false);
  });

  test("a waiting sign-in lapses after 15 minutes", async () => {
    const { signIn, id } = await waitingGuest();
    try {
      setSystemTime(Date.now() + 15 * 60_000 + 1);
      expect(signIn.status(id)).toEqual({ state: "failed", reason: "expired" });
      expect(signIn.waiting()).toEqual([]);
    } finally {
      setSystemTime();
    }
  });

  test("a sign-in pending when waiting is dropped stays dropped", async () => {
    const { signIn, github } = signingIn();
    const release = Promise.withResolvers<void>();
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === ACCESS_TOKEN) {
        await release.promise;
      }
      return github.fetcher(url, init);
    }) as typeof fetch;
    const held = new SignIn({
      clientId: "client-1",
      fetcher,
      runner: collaborator(0).runner,
      repo: () => "acme/shop",
      sleep: async () => {},
    });
    const { id } = await held.start();
    held.dropWaiting();
    release.resolve();
    await Bun.sleep(20);
    expect(held.waiting()).toEqual([]);
    expect(held.status(id)).toEqual({ state: "failed", reason: "expired" });
    expect(signIn.waiting()).toEqual([]);
  });

  test("dropWaiting empties the list", async () => {
    const { signIn } = await waitingGuest();
    signIn.dropWaiting();
    expect(signIn.waiting()).toEqual([]);
  });

  test("onChange fires when a sign-in starts and stops waiting", async () => {
    const { signIn, handle, events } = await waitingGuest();
    expect(events).toEqual(["change"]);
    signIn.answer(handle, true);
    expect(events).toEqual(["change", "change"]);
  });

  test("browserOf names the common browsers", () => {
    const cases = [
      [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "Safari on macOS",
      ],
      [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Chrome on Windows",
      ],
      ["Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0", "Firefox on Linux"],
      [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
        "Edge on Windows",
      ],
      [
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Safari on iOS",
      ],
      [
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "Chrome on Android",
      ],
    ];
    for (const [agent, name] of cases) {
      expect(browserOf(agent), name).toBe(name ?? "");
    }
    expect(browserOf(undefined)).toBeNull();
    expect(browserOf("curl/8.0")).toBeNull();
  });
});

describe("signing in through the share link", () => {
  async function shared(options: { polls?: object[]; gh?: ReturnType<typeof collaborator>; host?: string } = {}) {
    const github = fakeGithub(options.polls);
    const gh = options.gh ?? collaborator(0);
    const context = setup({ fetcher: github.fetcher, runner: gh.runner, host: options.host });
    await context.share.start();
    const code = context.share.guestCode ?? "";
    const opened = await context.app.request(`/?g=${code}`, { headers: { host: TUNNEL } });
    const link = (opened.headers.get("set-cookie") ?? "").replace(/;.*/, "");
    const visit = (path: string, init: RequestInit = {}) =>
      context.app.request(path, {
        ...init,
        headers: { host: TUNNEL, origin: `https://${TUNNEL}`, cookie: link, "x-prg-key": code, ...init.headers },
      });
    const finished = (id: string) =>
      until(
        async () => {
          const response = await visit(`/api/signin/${id}`);
          return { response, text: await response.text() };
        },
        ({ text }) => JSON.parse(text).state !== "pending",
      );
    return { ...context, github, gh, code, opened, link, visit, finished };
  }

  test("the token is never kept or returned", async () => {
    const { opened, link, visit, finished, people, signIn, store, page, post } = await shared({
      polls: [{ error: "authorization_pending" }],
    });
    const pushes: Push[] = [];
    store.addPageSink(push => pushes.push(push));
    expect(opened.status).toBe(200);
    const linkCookie = opened.headers.get("set-cookie") ?? "";
    expect(linkCookie).toStartWith(`prg_link_${PORT}=`);
    for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) {
      expect(linkCookie).toContain(flag);
    }

    const started = await visit("/api/signin", { method: "POST" });
    const startedText = await started.text();
    const said = [startedText, JSON.stringify([...started.headers])];
    expect(started.status).toBe(200);
    const { id, state } = JSON.parse(startedText);
    expect(state).toBe("pending");

    const waiting = await finished(id);
    said.push(waiting.text);
    expect(JSON.parse(waiting.text)).toEqual({ state: "waiting", person: ALICE, code: CODE });
    const [guest] = signIn.waiting();
    expect((await page(`/api/share/guests/${guest?.id}`, post({ allow: true }))).status).toBe(200);
    const response = await visit(`/api/signin/${id}`);
    const text = await response.text();
    said.push(text, JSON.stringify([...response.headers]));
    expect(JSON.parse(text)).toEqual({ state: "done", person: ALICE });
    const session = response.headers.get("set-cookie") ?? "";
    expect(session).toStartWith(`prg_guest_${PORT}=`);
    for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) {
      expect(session).toContain(flag);
    }
    expect(people.signedIn()).toContainEqual(ALICE);
    expect(pushes).toContainEqual({ type: "session" });

    const me = await visit("/api/me", { headers: { cookie: `${link}; ${session.replace(/;.*/, "")}` } });
    said.push(await me.clone().text());
    expect(await me.json()).toEqual({ role: "guest", person: ALICE, sharing: true });

    for (const text of [...said, Bun.inspect(signIn), Bun.inspect(people)]) {
      expect(text).not.toContain(GITHUB_TOKEN);
    }
  });

  test("someone who isn't a collaborator is refused", async () => {
    const gh = collaborator(1);
    const { visit, finished, people } = await shared({ gh });
    const { id } = (await (await visit("/api/signin", { method: "POST" })).json()) as { id: string };
    const { response, text } = await finished(id);
    expect(JSON.parse(text)).toEqual({ state: "failed", reason: "not-collaborator" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(people.signedIn()).toEqual([GUEST]);
    expect(gh.calls).toEqual([["gh", "api", "repos/acme/shop/collaborators/alice"]]);
  });

  test("an old guest code says the link has expired", async () => {
    const { app, share, visit, code } = await shared();
    share.stop();
    await share.start();
    for (const old of [code, "wrong"]) {
      const response = await app.request(`/?g=${old}`, { headers: { host: TUNNEL } });
      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("set-cookie")).toBeNull();
      const html = await response.text();
      expect(html).toContain("expired");
      expect(html).toContain("ask whoever shared it");
      expect(html).not.toContain("<script");
    }

    // The cookie the old link set stops working with it, whichever code it is sent with.
    expect((await visit("/")).status).toBe(401);
    expect((await visit("/api/signin", { method: "POST" })).status).toBe(401);
    expect((await visit("/api/signin", { method: "POST", headers: { "x-prg-key": share.guestCode ?? "" } })).status).toBe(401);
  });

  test("the share link and sign-in work only through the tunnel", async () => {
    const { app, code, visit } = await shared({ host: "192.168.1.20" });
    const computed = `prg_link_${PORT}=${createHash("sha256").update(code).digest("hex")}`;
    for (const host of [HOST, `192.168.1.20:${PORT}`]) {
      const opened = await app.request(`/?g=${code}`, { headers: { host } });
      expect(opened.status, host).toBe(401);
      expect(opened.headers.get("set-cookie")).toBeNull();
      expect(await opened.text()).toContain("ask whoever shared it");

      const headers = { host, origin: `http://${host}`, cookie: computed, "x-prg-key": code };
      expect((await app.request("/api/signin", { method: "POST", headers })).status, host).toBe(401);
      expect((await app.request("/", { headers })).status, host).toBe(401);
    }
    // The same cookie works on the tunnel, so it is the host that refuses it above.
    expect((await visit("/api/signin", { method: "POST", headers: { cookie: computed } })).status).toBe(200);
  });

  test("a guest session the server no longer knows goes back to sign-in", async () => {
    const { link, visit, people } = await shared();
    const known = `${link}; prg_guest_${PORT}=${people.issue(GUEST)}`;
    expect((await visit("/api/review", { headers: { cookie: known } })).status).toBe(200);
    people.revokeAll();

    expect((await visit("/")).status).toBe(200);
    for (const cookie of [link, known, `${link}; prg_guest_${PORT}=${"0".repeat(48)}`]) {
      for (const path of ["/api/review", "/api/me", "/api/messages", "/api/github/avatar/alice", "/api/ws"]) {
        const response = await visit(path, { headers: { cookie } });
        expect(response.status, path).toBe(401);
        expect(await response.json()).toEqual({ error: "sign in" });
      }
    }
    expect((await visit("/api/signin/nope")).status).toBe(404);
  });
});
