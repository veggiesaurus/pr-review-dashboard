import { describe, expect, test } from "bun:test";

import type { PersonTicks } from "../shared/messages";
import { stepsFor } from "../src/components/ready/tries";
import { GUEST, GUEST_CODE, loaded, OWNER, rawReview, setup } from "./helpers";

const steps = ["Save a title with a space at each end.", "Open [the helper](f1h1) with an empty title."];
const at = (sha: string) => ({ ...structuredClone(rawReview), try: steps, meta: { ...rawReview.meta, headSha: sha.repeat(40) } });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function asked() {
  const made = setup({ raw: at("a"), load: async () => loaded(at("c")), guestCode: () => GUEST_CODE });
  const frames: string[] = [];
  made.store.addSessionSink(frame => frames.push(frame));
  const ask = () => made.page("/api/tries", made.post({ layer: 12 }));
  return { ...made, frames, ask };
}

describe("steps Claude tries by hand", () => {
  test("one frame asks for every step, each a thread on its step, and says how to answer", async () => {
    const { store, frames, ask, guest, session, page, post } = asked();
    expect(await (await ask()).json()).toEqual({ sent: 2 });
    expect(frames).toHaveLength(1);
    expect(frames[0]).toStartWith("[review page] try 2 steps by hand on acme/shop#12 at aaaaaaa.");
    expect(frames[0]).toContain("Change no code");
    expect(frames[0]).toContain('m1 about a thing to try by hand: "Save a title with a space at each end."');
    expect(frames[0]).toContain('m2 about a thing to try by hand: "Open the helper with an empty title."');
    expect(store.messages.map(m => m.anchor)).toMatchObject([
      { kind: "try", layer: 12, index: 0 },
      { kind: "try", layer: 12, index: 1 },
    ]);

    // Running the change is the owner's to ask for.
    expect((await guest("/api/tries", post({ layer: 12 }))).status).toBe(403);
    expect((await session("/api/tries", post({ layer: 12 }))).status).toBe(403);
    expect((await page("/api/tries", post({ layer: 99 }))).status).toBe(400);
  });

  test("what happened is kept with the head it was tried at, and settles the thread", async () => {
    const { store, ask, session, post } = asked();
    await ask();
    const { id } = (await (await session("/api/attachments", { method: "POST", body: PNG })).json()) as { id: string };
    const reply = await session(
      "/api/replies",
      post({ replyTo: "m1", tried: "failed", text: "The trailing space is kept.", images: [id] }),
    );
    expect(await reply.json()).toMatchObject({
      from: "claude",
      replyTo: "m1",
      tried: { outcome: "failed", head: "a".repeat(40) },
      images: [id],
    });
    expect(store.find("m1")?.state).toBe("answered");

    const missing = `${"0".repeat(64)}.png`;
    expect((await session("/api/replies", post({ replyTo: "m2", tried: "passed", text: "ok", images: [missing] }))).status).toBe(400);
    expect((await session("/api/replies", post({ replyTo: "m2", tried: "passed", state: "answered" }))).status).toBe(400);
  });

  test("a step isn't asked for again while it waits or once it was tried at this head, and is after a rebuild", async () => {
    const { store, review, frames, ask, session, post } = asked();
    await ask();
    expect(await (await ask()).json()).toEqual({ sent: 0 });
    await session("/api/replies", post({ replyTo: "m1", tried: "passed", text: "Trimmed." }));
    await session("/api/replies", post({ replyTo: "m2", tried: "blocked", text: "Needs a browser." }));
    expect(await (await ask()).json()).toEqual({ sent: 0 });
    expect(frames).toHaveLength(1);

    await review.reload();
    expect(await (await ask()).json()).toEqual({ sent: 2 });
    expect(frames.at(-1)).toStartWith("[review page] try 2 steps by hand on acme/shop#12 at ccccccc.");
    expect(store.messages.filter(m => m.tried).map(m => m.tried?.head)).toEqual(["a".repeat(40), "a".repeat(40)]);
  });
});

describe("other people's reviewed ticks", () => {
  const mine = "prg:tick:acme/shop#12:src/slug.ts:own";
  const theirs = "prg:tick:acme/shop#12:src/slug.ts:guest";

  test("a guest sees what the owner ticked, the owner what each guest ticked, and nobody their own", async () => {
    const { page, guest, session, post } = asked();
    await page("/api/ticks", post({ keys: [mine], done: true }));
    await guest("/api/ticks", post({ keys: [theirs], done: true }));
    expect((await (await guest("/api/ticks/people")).json()) as PersonTicks[]).toEqual([{ role: "owner", person: OWNER, keys: [mine] }]);
    expect((await (await page("/api/ticks/people")).json()) as PersonTicks[]).toEqual([{ role: "guest", person: GUEST, keys: [theirs] }]);
    expect((await session("/api/ticks/people")).status).toBe(403);
  });

  test("a guest who has left is still named by what they wrote, and is nameless otherwise", async () => {
    const { page, guest, people, post } = asked();
    await guest("/api/ticks", post({ keys: [theirs], done: true }));
    people.revokeAll();
    expect(((await (await page("/api/ticks/people")).json()) as PersonTicks[])[0]?.person).toBeNull();

    const again = asked();
    await again.guest("/api/messages", again.post({ kind: "chat", text: "hi" }));
    await again.guest("/api/ticks", again.post({ keys: [theirs], done: true }));
    again.people.revokeAll();
    const [left] = (await (await again.page("/api/ticks/people")).json()) as PersonTicks[];
    expect(left?.person).toMatchObject({ id: GUEST.id, login: GUEST.login });
  });
});

describe("which section shows a step to try", () => {
  test("the one its link points into: a hunk the section holds, or a file it holds part of", () => {
    const parts = [
      { id: "f1", hunks: ["f1h1"] },
      { id: "f3", hunks: ["f3h2"] },
    ];
    const steps = [
      "Open [the helper](f1h1).",
      "Save [a post](f3).",
      "Check [the other hunk](f3h1), which another section holds.",
      "Try [the layer below](1014:f1h1).",
      "Read the logs.",
    ];
    expect(stepsFor(steps, parts)).toEqual([0, 1]);
  });
});
