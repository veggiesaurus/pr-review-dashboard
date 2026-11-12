import { describe, expect, test } from "bun:test";
import type { Hunk, HunkLine, ReviewFile } from "shared/payload";

import { bruBlockAt, bruStep, cardGaps, changedRanges, hunkUnits, layoutRows, oldLineOf, splitHighlighted } from "./diff";

const hunk = (
  id: string,
  oldStart: number,
  oldLines: number,
  newStart: number,
  newLines: number,
  lines: HunkLine[] = [],
  extra: Partial<Hunk> = {},
): Hunk => ({
  id,
  header: "",
  oldStart,
  oldLines,
  newStart,
  newLines,
  lines,
  blocks: [],
  noise: null,
  sig: id,
  moves: [],
  ...extra,
});

const file = (hunks: Hunk[], lineCount: number | null = 100, status: ReviewFile["status"] = "modified"): ReviewFile => ({
  id: "f1",
  path: "a.ts",
  oldPath: "a.ts",
  status,
  category: "implementation",
  why: null,
  noise: false,
  risk: [],
  additions: 0,
  deletions: 0,
  hunks,
  lineCount,
});

describe("old line numbers in gaps", () => {
  // Lines 10 to 12 of the base become 10 to 14; then line 30 of the base is deleted.
  const grown = hunk("f1h1", 10, 3, 10, 5, [
    [" ", 10, 10, "a"],
    ["+", null, 11, "b"],
    ["+", null, 12, "c"],
    [" ", 11, 13, "d"],
    [" ", 12, 14, "e"],
  ]);
  const deleted = hunk("f1h2", 30, 1, 31, 0, [["-", 30, null, "x"]]);

  test("follow each hunk's growth", () => {
    expect(oldLineOf([grown, deleted], 5)).toBe(5);
    expect(oldLineOf([grown, deleted], 15)).toBe(13);
    expect(oldLineOf([grown, deleted], 12)).toBeNull();
    expect(oldLineOf([grown, deleted], 13)).toBe(11);
  });

  test("count a hunk that only removes from the line after its new start", () => {
    expect(oldLineOf([grown, deleted], 31)).toBe(29);
    expect(oldLineOf([grown, deleted], 32)).toBe(31);
  });

  test("count a hunk that only adds from the line after its old start", () => {
    const added = hunk("f1h1", 4, 0, 5, 2, [
      ["+", null, 5, "p"],
      ["+", null, 6, "q"],
    ]);
    expect(oldLineOf([added], 4)).toBe(4);
    expect(oldLineOf([added], 7)).toBe(5);
  });
});

describe("gaps in a card", () => {
  const h1 = hunk("f1h1", 5, 2, 5, 2);
  const h2 = hunk("f1h2", 20, 2, 20, 2);
  const h3 = hunk("f1h3", 40, 2, 40, 2);

  test("unchanged lines at the top, between and at the bottom", () => {
    const { before, after } = cardGaps(file([h1, h2, h3], 50), [h1, h2, h3], () => null);
    expect(before.get("f1h1")).toEqual({ from: 1, to: 4, elsewhere: null, expandable: true });
    expect(before.get("f1h2")).toEqual({ from: 7, to: 19, elsewhere: null, expandable: true });
    expect(after).toEqual({ from: 42, to: 50, elsewhere: null, expandable: true });
  });

  test("a hidden hunk shown in another section turns the gap into a link there", () => {
    const where = (id: string) => ({ f1h1: 0, f1h2: 2, f1h3: 0 })[id] ?? null;
    const { before, after } = cardGaps(file([h1, h2, h3]), [h1, h3], where, 0);
    expect(before.get("f1h3")).toEqual({ from: 7, to: 39, elsewhere: { section: 2, hunk: "f1h2" }, expandable: false });
    expect(after?.elsewhere).toBeNull();
    const second = cardGaps(file([h1, h2, h3]), [h2], where, 2);
    expect(second.before.get("f1h2")?.elsewhere).toEqual({ section: 0, hunk: "f1h1" });
    expect(second.after).toEqual({ from: 22, to: 39, elsewhere: { section: 0, hunk: "f1h3" }, expandable: false });
  });

  test("no text on the server: gaps are counted but don't expand, and the bottom is unknown", () => {
    const { before, after } = cardGaps(file([h2], null), [h2], () => null);
    expect(before.get("f1h2")?.expandable).toBe(false);
    expect(after).toBeNull();
  });

  test("an added file has no gap above its only hunk", () => {
    const whole = hunk("f1h1", 0, 0, 1, 3);
    expect(cardGaps(file([whole], 3, "added"), [whole], () => null).before.size).toBe(0);
  });
});

describe("a hunk's rows", () => {
  const lines: HunkLine[] = [
    ["-", 1, null, "  a()"],
    ["+", null, 1, "a()"],
    ["-", 2, null, "old"],
    ["+", null, 2, "new"],
    ["-", 3, null, "m1"],
    ["-", 4, null, "m2"],
    ["-", 5, null, "m3"],
    [" ", 6, 3, "ctx"],
  ];
  const h = hunk("f1h1", 1, 6, 1, 3, lines, {
    blocks: [
      { start: 0, end: 2, noise: "whitespace" },
      { start: 2, end: 7, noise: null },
    ],
    moves: [{ side: "-", start: 4, end: 7, to: "f2h1", line: "R8" }],
  });

  test("formatting hidden: the new form once, as context, and the moved block folded", () => {
    const units = hunkUnits(h, false);
    expect(units.map(u => (u.kind === "move" ? "move" : `${u.row[0]}${u.row[3]}`))).toEqual([" a()", "-old", "+new", "move", " ctx"]);
  });

  test("formatting shown: both sides, dimmed; Show them puts the moved lines back", () => {
    const units = hunkUnits(h, true, new Set([4]));
    expect(units.map(u => (u.kind === "move" ? "move" : `${u.row[0]}${u.tone ?? ""}`))).toEqual([
      "-noise",
      "+noise",
      "-",
      "+",
      "-",
      "-",
      "-",
      " ",
    ]);
  });

  test("split pairs removed and added lines within a run, but not lines put back from a move", () => {
    const rows = layoutRows(hunkUnits(h, true, new Set([4])), true);
    const shape = rows.map(r =>
      r.kind === "move" ? "move" : r.halves.map(x => (x ? `${x.unit.row[0]}${x.old ? "o" : ""}` : "_")).join(""),
    );
    expect(shape).toEqual(["-+", "-+", "-_", "-_", "-_", " o "]);
  });
});

test("highlighted HTML splits into lines, with open spans carrying over and entities decoded", () => {
  const lines = splitHighlighted(
    '<span class="hljs-comment">/* a &amp;&lt;\nb */</span> x &gt; <span class="hljs-string">&quot;y&#x27;</span>',
  );
  expect(lines).toEqual([
    [{ text: "/* a &<", classes: ["hljs-comment"] }],
    [
      { text: "b */", classes: ["hljs-comment"] },
      { text: " x > ", classes: [] },
      { text: "\"y'", classes: ["hljs-string"] },
    ],
  ]);
});

test("a .bru line's language comes from the block it sits in", () => {
  expect(bruStep(null, "tests {")).toEqual(["bru", "tests"]);
  expect(bruStep("tests", "  expect(1)")).toEqual(["javascript", "tests"]);
  expect(bruStep("body:json", "  {")).toEqual(["json", "body:json"]);
  expect(bruStep("tests", "}")).toEqual(["bru", null]);
  const blocks = [{ name: "meta", open: 1, close: 5 }];
  expect([1, 2, 5, 6].map(n => bruBlockAt(blocks, n))).toEqual([null, "meta", "meta", null]);
});

test("changed words are marked on both sides", () => {
  expect(changedRanges("to.be.a(x)", "to.equal(x)")).toEqual([[[3, 7]], [[3, 8]]]);
});
