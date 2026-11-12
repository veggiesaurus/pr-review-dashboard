import type { BruBlock, Hunk, HunkLine, Move, ReviewFile } from "shared/payload";

// ---- languages, as the template picks them ----

const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  css: "css",
  scss: "scss",
  less: "less",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  md: "markdown",
  html: "xml",
  xml: "xml",
  svg: "xml",
  rs: "rust",
  java: "java",
  cs: "csharp",
  kt: "kotlin",
  rb: "ruby",
  php: "php",
  toml: "ini",
  ini: "ini",
  graphql: "graphql",
  bru: "bru",
};

export function languageOf(path: string): string | null {
  if (/(^|\/)Makefile$/.test(path)) {
    return "makefile";
  }
  return LANGUAGES[path.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

const PROSE_OR_DATA = new Set(["markdown", "json", "yaml", "ini"]);

// Whether a file's words can be names worth looking up: code, not prose, data or anything generated.
export const hasNames = (file: ReviewFile) =>
  (file.category === "implementation" || file.category === "test") && !PROSE_OR_DATA.has(languageOf(file.path) ?? "");

// Bruno's .bru files are named blocks of `key: value` lines; scripts, tests, bodies and docs hold another language.
const BRU_OPEN = /^([a-z][\w:-]*)\s*\{\s*$/;
const BRU_CLOSE = /^\}\s*$/;
const BRU_INNER: [RegExp, string][] = [
  [/^(script:|tests$)/, "javascript"],
  [/^body:(json|graphql:vars)$/, "json"],
  [/^body:graphql$/, "graphql"],
  [/^body:xml$/, "xml"],
  [/^docs$/, "markdown"],
];

// One line on from block `block` (null between blocks): the line's language and the block after it.
export function bruStep(block: string | null, text: string): [language: string, next: string | null] {
  if (!block) {
    return ["bru", BRU_OPEN.exec(text)?.[1] ?? null];
  }
  if (BRU_CLOSE.test(text)) {
    return ["bru", null];
  }
  return [BRU_INNER.find(([pattern]) => pattern.test(block))?.[1] ?? "bru", block];
}

// The block line n starts in, worked out by the server from the whole new file.
export const bruBlockAt = (blocks: BruBlock[] | undefined, n: number) => blocks?.find(b => b.open < n && n <= b.close)?.name ?? null;

// ---- highlighted text ----

// A run of text with the classes of every span around it, outermost first.
export type Segment = { text: string; classes: string[] };

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };

// highlight.js's HTML for several lines as each line's segments, so the page draws text and never HTML. A span
// open at the end of a line carries on into the next, which is how block comments and template strings work.
export function splitHighlighted(html: string): Segment[][] {
  const lines: Segment[][] = [[]];
  const open: string[] = [];
  for (const part of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (!part) {
      continue;
    }
    if (part === "\n") {
      lines.push([]);
    } else if (part.startsWith("<span")) {
      open.push(/class="([^"]*)"/.exec(part)?.[1] ?? "");
    } else if (part === "</span>") {
      open.pop();
    } else {
      lines.at(-1)?.push({ text: part.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, m => ENTITIES[m] ?? m), classes: [...open] });
    }
  }
  return lines;
}

// ---- word-level changes inside paired removed and added lines ----

export type Range = [start: number, end: number];

const tokens = (text: string) => text.match(/\w+|\s+|[^\w\s]/g) ?? [];

// The changed character ranges of a and b, from the longest common run of tokens.
export function changedRanges(a: string, b: string): [Range[], Range[]] {
  const A = tokens(a);
  const B = tokens(b);
  if (A.length * B.length > 40_000) {
    return [[[0, a.length]], [[0, b.length]]];
  }
  const table = Array.from({ length: A.length + 1 }, () => new Int32Array(B.length + 1));
  const at = (i: number, j: number) => table[i]?.[j] ?? 0;
  for (let i = A.length - 1; i >= 0; i--) {
    const row = table[i];
    for (let j = B.length - 1; j >= 0 && row; j--) {
      row[j] = A[i] === B[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const ra: Range[] = [];
  const rb: Range[] = [];
  const push = (ranges: Range[], start: number, end: number) => {
    const last = ranges.at(-1);
    if (last && last[1] === start) {
      last[1] = end;
    } else {
      ranges.push([start, end]);
    }
  };
  let i = 0;
  let j = 0;
  let pa = 0;
  let pb = 0;
  while (i < A.length || j < B.length) {
    const x = A[i];
    const y = B[j];
    if (x !== undefined && x === y) {
      pa += x.length;
      pb += x.length;
      i++;
      j++;
    } else if (y !== undefined && (x === undefined || at(i, j + 1) >= at(i + 1, j))) {
      push(rb, pb, pb + y.length);
      pb += y.length;
      j++;
    } else if (x !== undefined) {
      push(ra, pa, pa + x.length);
      pa += x.length;
      i++;
    }
  }
  return [ra, rb];
}

// Marks for each line of a hunk, by index into hunk.lines: the changed words of each removed line paired with an
// added one, in real changes only, and only where the pair still reads as the same line.
export function wordMarks(hunk: Hunk): Map<number, Range[]> {
  const marks = new Map<number, Range[]>();
  const skip = new Set(hunk.blocks.flatMap(block => block.reindented ?? []));
  for (const move of hunk.moves) {
    for (let i = move.start; i < move.end; i++) {
      skip.add(i);
    }
  }
  for (const block of hunk.blocks) {
    if (block.noise) {
      continue;
    }
    const dels: number[] = [];
    const adds: number[] = [];
    for (let i = block.start; i < block.end; i++) {
      if (!skip.has(i)) {
        (hunk.lines[i]?.[0] === "-" ? dels : adds).push(i);
      }
    }
    const pairs = Math.min(dels.length, adds.length);
    if (!pairs || Math.max(dels.length, adds.length) > pairs * 2) {
      continue;
    }
    for (let k = 0; k < pairs; k++) {
      const del = dels[k] as number;
      const add = adds[k] as number;
      const a = hunk.lines[del]?.[3] ?? "";
      const [ra, rb] = changedRanges(a, hunk.lines[add]?.[3] ?? "");
      if (ra.reduce((sum, [s, e]) => sum + e - s, 0) > a.length * 0.7) {
        continue;
      }
      marks.set(del, ra);
      marks.set(add, rb);
    }
  }
  return marks;
}

// ---- a hunk's rows ----

// tone: moved code where it landed, or formatting shown dimmed. pair: whether split view may set it beside a line
// from the other side.
export type LineUnit = { kind: "line"; index: number; row: HunkLine; tone: "moved" | "noise" | null; pair: boolean };
export type MoveUnit = { kind: "move"; move: Move };
export type Unit = LineUnit | MoveUnit;

// The template's hunkRows: formatting lines show once, as context, unless formatting is shown; a block moved away
// folds into one row unless its start is in `shown`, and a block that landed here gets a row saying where from.
export function hunkUnits(hunk: Hunk, formatting: boolean, shown: ReadonlySet<number> = new Set()): Unit[] {
  const noisy = new Set<number>();
  const reindented = new Set<number>();
  for (const block of hunk.blocks) {
    if (block.noise) {
      for (let i = block.start; i < block.end; i++) {
        noisy.add(i);
      }
    }
    for (const i of block.reindented ?? []) {
      reindented.add(i);
    }
  }
  const told = new Set<Move>();
  const units: Unit[] = [];
  hunk.lines.forEach((row, index) => {
    const move = hunk.moves.find(m => index >= m.start && index < m.end);
    const fmt = noisy.has(index) || reindented.has(index);
    if (!formatting && fmt) {
      if (row[0] === "+") {
        units.push({ kind: "line", index, row: [" ", row[1], row[2], row[3]], tone: null, pair: false });
      }
      return;
    }
    if (move?.side === "-" && shown.has(move.start)) {
      units.push({ kind: "line", index, row, tone: null, pair: false });
      return;
    }
    if (move && !told.has(move)) {
      told.add(move);
      units.push({ kind: "move", move });
    }
    if (move?.side === "-") {
      return;
    }
    units.push({ kind: "line", index, row, tone: move ? "moved" : fmt ? "noise" : null, pair: !move });
  });
  return units;
}

// One side of a row: a line, and for a split context line's left half, old says to number it in the base.
export type Half = { unit: LineUnit; old: boolean } | null;
export type Row = { kind: "line"; halves: Half[] } | MoveUnit;

// Unified rows hold one half. Split rows hold two, removed and added lines side by side within each run of changes.
export function layoutRows(units: Unit[], split: boolean): Row[] {
  if (!split) {
    return units.map(unit => (unit.kind === "move" ? unit : { kind: "line", halves: [{ unit, old: false }] }));
  }
  const rows: Row[] = [];
  let dels: LineUnit[] = [];
  let adds: LineUnit[] = [];
  const half = (unit: LineUnit | undefined, old = false): Half => (unit ? { unit, old } : null);
  const flush = () => {
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      rows.push({ kind: "line", halves: [half(dels[k]), half(adds[k])] });
    }
    dels = [];
    adds = [];
  };
  for (const unit of units) {
    if (unit.kind === "line" && unit.pair && unit.row[0] !== " ") {
      (unit.row[0] === "-" ? dels : adds).push(unit);
      continue;
    }
    flush();
    if (unit.kind === "move") {
      rows.push(unit);
    } else if (unit.row[0] === " ") {
      rows.push({ kind: "line", halves: [half(unit, true), half(unit)] });
    } else {
      rows.push({ kind: "line", halves: unit.row[0] === "-" ? [half(unit), null] : [null, half(unit)] });
    }
  }
  flush();
  return rows;
}

// ---- where a hunk sits in its file ----

// git numbers an empty side from the line before it, so a hunk that adds or removes only starts one line later.
export const firstOld = (hunk: Hunk) => (hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart);
export const firstNew = (hunk: Hunk) => (hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart);
export const endOld = (hunk: Hunk) => firstOld(hunk) + hunk.oldLines;
export const endNew = (hunk: Hunk) => firstNew(hunk) + hunk.newLines;

// The base's number for line n of the new file: null for a line a hunk adds.
export function oldLineOf(hunks: Hunk[], n: number): number | null {
  let offset = 0;
  for (const hunk of hunks) {
    if (n < firstNew(hunk)) {
      break;
    }
    if (n < endNew(hunk)) {
      return hunk.lines.find(row => row[2] === n)?.[1] ?? null;
    }
    offset = endOld(hunk) - endNew(hunk);
  }
  return n + offset;
}

// New-side lines from..to that the card doesn't show. elsewhere names the section holding hunks hidden in them;
// otherwise the lines are unchanged as far as this card goes, and can be fetched when the server holds the file.
export type Gap = { from: number; to: number; elsewhere: { section: number; hunk: string } | null; expandable: boolean };

// The gap above each shown hunk, and the one after the last. where(hunk) is the section a hunk shows in, or null
// when it isn't shown anywhere (no sections, or formatting hidden).
export function cardGaps(file: ReviewFile, shown: Hunk[], where: (hunk: string) => number | null, section?: number) {
  const all = file.hunks;
  const elsewhere = (hunks: Hunk[]) => {
    for (const hunk of hunks) {
      const at = where(hunk.id);
      if (at !== null && at !== section) {
        return { section: at, hunk: hunk.id };
      }
    }
    return null;
  };
  const expandable = file.lineCount !== null;
  const before = new Map<string, Gap>();
  let prev: Hunk | null = null;
  for (const hunk of shown) {
    const between = all.slice(prev ? all.indexOf(prev) + 1 : 0, all.indexOf(hunk));
    const from = prev ? endNew(prev) : 1;
    const to = firstNew(hunk) - 1;
    const other = elsewhere(between);
    if (other) {
      before.set(hunk.id, { from, to, elsewhere: other, expandable: false });
    } else if (to >= from && (between.length > 0 || (file.status !== "added" && file.status !== "deleted"))) {
      before.set(hunk.id, { from, to, elsewhere: null, expandable });
    }
    prev = hunk;
  }
  let after: Gap | null = null;
  if (prev) {
    const rest = all.slice(all.indexOf(prev) + 1);
    const other = elsewhere(rest);
    const from = endNew(prev);
    if (other) {
      const next = all.find(hunk => hunk.id === other.hunk);
      after = { from, to: next ? firstNew(next) - 1 : from - 1, elsewhere: other, expandable: false };
    } else if (file.lineCount !== null && file.lineCount >= from) {
      after = { from, to: file.lineCount, elsewhere: null, expandable: true };
    }
  }
  return { before, after };
}

// ---- the view's filter ----

// The view store's Show, kept apart so this file needs no DOM.
type Show = { kind: "all" } | { kind: "fresh" } | { kind: "commit"; index: number };

// Whether the chosen part of the change touches a hunk.
export function showsHunk(show: Show, hunk: Hunk) {
  if (show.kind === "fresh") {
    return Boolean(hunk.fresh);
  }
  return show.kind === "commit" ? (hunk.commits ?? []).includes(show.index) : true;
}

// "src/a/b.ts" as its name and its folder, the folder with its slash.
export function splitPath(path: string): [name: string, folder: string] {
  const i = path.lastIndexOf("/");
  return [path.slice(i + 1), i < 0 ? "" : path.slice(0, i + 1)];
}
