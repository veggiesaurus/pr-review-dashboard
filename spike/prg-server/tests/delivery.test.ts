import { expect, test } from "bun:test";

import { openDb } from "../server/db";
import { Store } from "../server/store";
import { addedLine, loaded, rawReview, setup } from "./helpers";

function listen(store: Store) {
  const frames: string[] = [];
  return { frames, stop: store.addSessionSink(frame => frames.push(frame)) };
}
const heads = (frames: string[]) => frames.map(frame => frame.split("\n")[0]);

test("a frame goes again until the session is heard from, through a dropped socket and a restart", () => {
  const { review } = setup();
  const db = openDb();
  const store = new Store(review, { db });
  const first = listen(store);
  store.addUserMessage({ kind: "chat", text: "one" });
  store.heard(1);
  store.addUserMessage({ kind: "chat", text: "two" });
  store.tell("[review page] the checks went red");
  first.stop();
  expect(store.messages.map(m => m.status)).toEqual(["delivered", "sent"]);

  const unanswered = ["[review page] chat m2 on acme/shop#12 at aaaaaaa", "[review page] the checks went red"];
  const second = listen(store);
  expect(heads(second.frames)).toEqual(unanswered);
  second.stop();

  const restarted = new Store(review, { db });
  expect(heads(listen(restarted).frames)).toEqual(unanswered);
  restarted.heard();
  expect(restarted.messages.map(m => m.status)).toEqual(["delivered", "delivered"]);
  expect(listen(new Store(review, { db })).frames).toEqual([]);
});

test("a thread left as being worked on is offered again to the next session, and after a restart", () => {
  const { review } = setup();
  const db = openDb();
  const store = new Store(review, { db });
  const first = listen(store);
  store.addUserMessage({ kind: "chat", text: "why trim here?", anchor: { ...addedLine, kind: "line", side: "R" } });
  store.heard();
  store.addReply({ replyTo: "m1", state: "working" });
  first.stop();

  const { frames } = listen(store);
  expect(frames).toHaveLength(1);
  expect(frames[0]).toStartWith("[review page] chat m1 on acme/shop#12 at aaaaaaa\nabout src/slug.ts:R2@aaaaaaa");
  expect(frames[0]).toEndWith("carry on if that was you)");
  expect(store.messages[0]).toMatchObject({
    state: "open",
    events: [{ text: "Offered again: the session working on it stopped listening" }],
  });

  // The session that took it up again dies with the server; the next one is asked once more.
  store.heard();
  store.addReply({ replyTo: "m1", state: "working" });
  expect(heads(listen(new Store(review, { db })).frames)).toEqual(["[review page] chat m1 on acme/shop#12 at aaaaaaa"]);
});

test("a fix or a re-check too long for one frame comes in parts that leave no finding out", async () => {
  const next = structuredClone(rawReview);
  next.meta.headSha = "b".repeat(40);
  const { store, review, page, session, post } = setup({ load: async () => loaded(next) });
  const { frames } = listen(store);
  await page("/api/reviews", post({ layer: 12, effort: "low" }));
  const findings = Array.from({ length: 9 }, (_, i) => ({
    file: "src/slug.ts",
    line: 2,
    summary: `${i} ${"x".repeat(1900)}`,
    recommended: true,
  }));
  await session("/api/reviews/1/findings", post({ findings }));
  const named = (from: number) =>
    [
      ...frames
        .slice(from)
        .join("\n")
        .matchAll(/^(m\d+) about/gm),
    ].map(match => match[1]);
  const ids = store.messages.filter(m => m.from === "claude").map(m => m.id);

  await review.reload();
  expect(frames[1]).toContain("re-check 9 review findings");
  expect(frames[1]).toContain(`It comes in ${frames.length - 1} parts.`);
  expect(frames[2]).toStartWith(`[review page] re-check, part 2 of ${frames.length - 1}`);
  expect(named(1)).toEqual(ids);
  expect(frames.every(frame => frame.length <= 6100 && !frame.includes("cut short"))).toBe(true);

  const before = frames.length;
  await page("/api/reviews/1/fix", { method: "POST" });
  expect(frames[before + 1]).toStartWith("[review page] fix of review 1, part 2 of");
  expect(named(before)).toEqual(ids);
});
