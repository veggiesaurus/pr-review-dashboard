import { expect, test } from "bun:test";

import { openDb } from "../server/db";
import { Review } from "../server/review";
import { Store } from "../server/store";
import { loaded } from "./helpers";

const meta = (sha: string) => ({ repo: "acme/shop", number: 12, title: "t", head: "feature", headSha: sha.repeat(40) });
const review = (raw: unknown, next: unknown = raw) => new Review(loaded(raw), async () => loaded(next));
const hunk = (text: string[], from: number, to: number, added: number[]) => ({
  id: "f1h1",
  oldStart: from,
  newStart: from,
  lines: Array.from({ length: to - from + 1 }, (_, i) => {
    const n = from + i;
    return added.includes(n) ? ["+", null, n, text[n - 1]] : [" ", n, n, text[n - 1]];
  }),
});
const build = (sha: string, text: string[], from: number, to: number, added: number[]) => ({
  meta: meta(sha),
  files: [{ id: "f1", path: "src/a.ts", status: "modified", newText: [...text, ""], hunks: [hunk(text, from, to, added)] }],
});
const at = (line: number, endLine?: number) => ({
  kind: "line" as const,
  layer: 12,
  file: "f1",
  hunk: "f1h1",
  side: "R" as const,
  line,
  endLine,
});

// Thirty lines with a brace at 3, 13 and 20; the hunk shows 10 to 14.
const text = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
for (const n of [3, 13, 20]) {
  text[n - 1] = "}";
}
const first = build("a", text, 10, 14, [12]);

test("a note on a repeated line follows its own copy through a rebuild, and goes outdated when that copy is gone", async () => {
  // Eight lines go in above, so the brace at 13 is now at 21, and an unrelated brace is new at 14.
  const grown = [...text.slice(0, 9), ...Array.from({ length: 8 }, (_, i) => `new ${i}`), ...text.slice(9)];
  grown[13] = "}";
  const moved = review(first, build("b", grown, 10, 24, [10, 11, 12, 13, 14, 15, 16, 17, 20]));
  const store = new Store(moved);
  store.addUserMessage({ kind: "note", text: "closes the wrong block", anchor: at(13) }, null);
  await moved.reload();
  expect(store.messages[0]?.anchor).toMatchObject({ line: 21, code: "}" });
  expect(store.messages[0]?.anchor.outdated).toBeUndefined();

  // Its own brace and the lines around it are rewritten; the other braces aren't it.
  const rewritten = text.map((line, i) => (i >= 9 && i <= 15 ? `other ${i}` : line));
  const gone = review(first, build("c", rewritten, 10, 16, [10, 11, 12, 13, 14, 15, 16]));
  const left = new Store(gone);
  left.addUserMessage({ kind: "note", text: "closes the wrong block", anchor: at(13) }, null);
  await gone.reload();
  expect(left.messages[0]?.anchor).toMatchObject({ line: 13, outdated: true });
});

test("a restart keeps a note on an opened unchanged line, a long range, and a thread kept before neighbours were", () => {
  const db = openDb();
  const store = new Store(review(first), { db });
  store.addUserMessage({ kind: "note", text: "a brace no hunk shows", anchor: at(20) }, null);
  expect(new Store(review(first), { db }).messages[0]?.anchor).toMatchObject({ line: 20, loc: "src/a.ts:R20@aaaaaaa" });

  // Sixty lines of eighty characters: more code than a thread keeps.
  const long = Array.from({ length: 60 }, (_, i) => `${"x".repeat(78)}${i}`);
  const wide = build(
    "a",
    long,
    1,
    60,
    long.map((_, i) => i + 1),
  );
  const ranged = openDb();
  new Store(review(wide), { db: ranged }).addUserMessage({ kind: "note", text: "the whole block", anchor: at(1, 60) }, null);
  const again = new Store(review(wide), { db: ranged }).messages[0]?.anchor;
  expect(again).toMatchObject({ line: 1, endLine: 60 });
  expect(again?.outdated).toBeUndefined();

  db.run("update messages set body = json_remove(body, '$.anchor.around')");
  expect(new Store(review(first), { db }).messages[0]?.anchor).toMatchObject({
    line: 20,
    around: [["line 19", "line 18", "line 17"], expect.any(Array)],
  });
});

test("a thread on one part of the summary follows that part through a rebuild, and goes outdated when it is gone", async () => {
  const summary = { exec: "E.", product: "P.", developer: "D.", reviewer: "R.", qa: "- Open a post\n- Open an old link" };
  const personas = ["exec", "product", "developer", "reviewer"].map(id => ({ id, name: id })).concat({ id: "qa", name: "QA" });
  const before = { ...first, summary, personas };
  const grown = {
    ...build("b", text, 10, 14, [12]),
    personas,
    summary: { ...summary, qa: "- Check the index\n- Open a post\n- Open an old link" },
  };
  const onOldLink = { kind: "summary" as const, layer: 12, reader: "qa" as const, index: 1 };

  const moved = review(before, grown);
  const store = new Store(moved);
  expect(store.addUserMessage({ kind: "chat", text: "and the RSS feed?", anchor: { ...onOldLink, index: 9 } }, null)).toBeNull();
  store.addUserMessage({ kind: "chat", text: "and the RSS feed?", anchor: onOldLink }, null);
  expect(store.messages[0]?.anchor.label).toBe('an item of the summary for QA: "Open an old link"');
  await moved.reload();
  expect(store.messages[0]?.anchor).toMatchObject({ reader: "qa", index: 2 });
  expect(store.messages[0]?.anchor.outdated).toBeUndefined();

  const gone = review(before, { ...grown, summary: { ...summary, qa: "- Check the index" } });
  const left = new Store(gone);
  left.addUserMessage({ kind: "chat", text: "and the RSS feed?", anchor: onOldLink }, null);
  await gone.reload();
  expect(left.messages[0]?.anchor.outdated).toBe(true);
});
