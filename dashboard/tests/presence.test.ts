import { describe, expect, test } from "bun:test";

import { Presence, parseWhere } from "../server/presence";
import type { Author, Where } from "../shared/messages";
import { GUEST, GUEST_CODE, OWNER, setup } from "./helpers";

const gus: Author = { ...GUEST, role: "guest" };
const olive: Author = { ...OWNER, role: "owner" };
const where = (patch: Partial<Where> = {}): Where => ({ type: "where", layer: 12, tab: "guide", section: 0, hidden: false, ...patch });

describe("presence", () => {
  test("one person on two sockets shows once, at the latest", () => {
    const presence = new Presence();
    presence.join("a", gus);
    presence.join("b", gus);
    presence.move("a", where({ section: 1 }));
    presence.move("b", where({ section: 2 }));
    expect(presence.list().map(entry => [entry.person.login, entry.section])).toEqual([["gus", 2]]);
  });

  test("a reconnect doesn't duplicate a person", () => {
    const presence = new Presence();
    presence.join("old", gus);
    presence.move("old", where({ section: 1 }));
    presence.join("new", gus);
    presence.move("new", where({ section: 3 }));
    expect(presence.list()).toHaveLength(1);
    presence.leave("old");
    expect(presence.list().map(entry => entry.section)).toEqual([3]);
  });

  test("leaving removes the entry", () => {
    const presence = new Presence();
    presence.join("a", gus);
    presence.join("b", olive);
    presence.move("a", where());
    presence.move("b", where());
    presence.leave("a");
    expect(presence.list().map(entry => entry.person.login)).toEqual(["olive"]);
    presence.leave("b");
    expect(presence.list()).toEqual([]);
  });

  test("since changes only when hidden does", () => {
    const presence = new Presence();
    presence.join("a", gus);
    presence.move("a", where());
    const first = presence.list()[0]?.since;
    presence.move("a", where({ section: 4 }));
    expect(presence.list()[0]?.since).toBe(first);
    expect(presence.list()[0]?.role).toBe("guest");
  });

  test("a bad where message is ignored", () => {
    expect(parseWhere("not json")).toBeNull();
    expect(parseWhere(JSON.stringify({ type: "where", layer: "x" }))).toBeNull();
    expect(parseWhere(JSON.stringify({ ...where(), tab: "elsewhere" }))).toBeNull();
    expect(parseWhere(JSON.stringify(where()))).toEqual(where());
    const presence = new Presence();
    presence.move("nobody", where());
    expect(presence.list()).toEqual([]);
  });

  test("GET /api/presence is open to the owner and guest, not the session", async () => {
    const { page, guest, session, store } = setup({ guestCode: () => GUEST_CODE });
    store.presence.join("a", gus);
    store.presence.move("a", where());
    expect(((await (await page("/api/presence")).json()) as unknown[]).length).toBe(1);
    expect((await guest("/api/presence")).status).toBe(200);
    expect((await session("/api/presence")).status).toBe(403);
  });
});

describe("presence pictures", () => {
  test("a connected person's GitHub picture is served by the avatar route, anyone else's URL is not", async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const fetcher = (async () => new Response(png, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
    const { page, store } = setup({ fetcher });
    expect((await page("/api/github/avatar/gus")).status).toBe(404);
    store.presence.join("a", gus);
    expect((await page("/api/github/avatar/gus")).status).toBe(200);
    store.presence.join("b", { ...olive, avatar: "https://evil.example/a.png" });
    expect((await page("/api/github/avatar/olive")).status).toBe(404);
  });
});
