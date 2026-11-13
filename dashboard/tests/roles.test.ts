import { describe, expect, test } from "bun:test";

import { GUEST, GUEST_CODE, HOST, LINK, ORIGIN, OWNER, PORT, setup } from "./helpers";

const sharing = () => setup({ guestCode: () => GUEST_CODE });

const OWNER_ONLY = [
  ["POST", "/api/messages/m1/archive"],
  ["POST", "/api/reviews"],
  ["POST", "/api/reviews/1/fix"],
  ["POST", "/api/reviews/1/archive"],
  ["POST", "/api/layers/12/local/revert"],
  ["GET", "/api/layers/12/local"],
  ["POST", "/api/layers/12/comments/preview"],
  ["POST", "/api/layers/12/comments/post"],
  ["PUT", "/api/github/notify"],
  ["GET", "/api/share"],
  ["POST", "/api/share"],
  ["DELETE", "/api/share"],
] as const;

describe("roles", () => {
  test("a guest is refused every owner-only route", async () => {
    const { guest } = sharing();
    for (const [method, path] of OWNER_ONLY) {
      const response = await guest(path, { method });
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await response.json()).toEqual({ error: "only the owner may do this" });
    }
  });

  test("a guest may use the shared routes", async () => {
    const { guest, post } = sharing();
    expect((await guest("/api/review")).status).toBe(200);
    expect((await guest("/api/messages")).status).toBe(200);
    expect((await guest("/api/messages", post({ kind: "chat", text: "hi" }))).status).toBe(201);
    expect((await guest("/api/ticks", post({ keys: [], done: true }))).status).toBe(200);
  });

  test("guest credentials do nothing while not sharing", async () => {
    const { guest } = setup({ guestCode: () => null });
    expect((await guest("/api/review")).status).toBe(401);
  });

  test("a guest needs a live session and the share code of now", async () => {
    let code = GUEST_CODE;
    const { app, guest, people } = setup({ guestCode: () => code });
    const ask = (session: string, key: string) =>
      app.request("/api/review", { headers: { host: HOST, origin: ORIGIN, cookie: `prg_guest_${PORT}=${session}`, "x-prg-key": key } });
    people.issue(GUEST);
    expect(people.signedIn()).toEqual([GUEST]);
    expect((await ask("0".repeat(48), GUEST_CODE)).status).toBe(401);
    expect((await guest("/api/review", { headers: { "x-prg-key": LINK } })).status).toBe(401);

    code = "n".repeat(48);
    expect((await guest("/api/review")).status).toBe(401);
    code = GUEST_CODE;
    expect((await guest("/api/review")).status).toBe(200);
    people.revokeAll();
    expect((await guest("/api/review")).status).toBe(401);
    expect(people.signedIn()).toEqual([]);
  });

  test("/api/me says who is asking", async () => {
    const { page, people } = setup();
    expect(await (await page("/api/me")).json()).toEqual({ role: "owner", person: OWNER, sharing: false });
    people.owner = null;
    expect(await (await page("/api/me")).json()).toEqual({ role: "owner", person: null, sharing: false });

    const { guest } = sharing();
    expect(await (await guest("/api/me")).json()).toEqual({ role: "guest", person: GUEST, sharing: true });
  });
});
