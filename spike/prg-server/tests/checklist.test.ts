import { expect, test } from "bun:test";

import type { Message } from "../shared/messages";
import { addedLine, loaded, rawReview, setup } from "./helpers";

const STEPS = [
  "Save a post titled ' Hello ' and check its link, as [the slug](f1h1) in [this file](f1) is trimmed now.",
  "Open an old link.",
];

test("a step to try by hand takes a thread that quotes it, and a rebuild finds it by its words or marks it gone", async () => {
  let raw = { ...rawReview, try: STEPS };
  const { store, review, page, post } = setup({ raw, load: async () => loaded(raw) });
  const send = (index: number) =>
    page("/api/messages", post({ kind: "chat", text: "this didn't work", anchor: { kind: "try", layer: 12, index } }));
  expect((await send(0)).status).toBe(201);
  expect((await send(1)).status).toBe(201);
  expect((await send(2)).status).toBe(400);
  expect(store.messages[0]?.anchor).toMatchObject({
    label: `a thing to try by hand: "Save a post titled ' Hello ' and check its link, as the slug in this file is trimmed now."`,
    detail: "In src/slug.ts:R1-R2@aaaaaaa (f1h1), src/slug.ts@aaaaaaa",
  });

  raw = { ...rawReview, try: ["Something new.", STEPS[0] as string] };
  await review.reload();
  expect(store.messages.map(m => [m.anchor.kind === "try" && m.anchor.index, m.anchor.outdated ?? false])).toEqual([
    [1, false],
    [1, true],
  ]);
});

test("a note's label goes to the session beside its id, and a batch with none reads as before", async () => {
  const { store, page, post } = setup();
  const frames: string[] = [];
  store.addSessionSink(frame => frames.push(frame));
  const add = (body: object) => page("/api/messages", post({ anchor: addedLine, ...body }));
  await add({ kind: "note", text: "plain" });
  store.sendDrafts();
  expect(frames[0]).not.toContain("marked (fix)");

  expect((await add({ kind: "note", text: "is this needed?", intent: "question" })).status).toBe(201);
  expect((await add({ kind: "note", text: "x", intent: "praise" })).status).toBe(400);
  const chat = (await (await add({ kind: "chat", text: "now", intent: "nit" })).json()) as Message;
  expect(chat.intent).toBeUndefined();
  store.sendDrafts();
  expect(frames.at(-1)).toContain("(question) an answer and no change");
  expect(frames.at(-1)).toContain("\n\nm2 (question) about src/slug.ts:R2@aaaaaaa");
});
