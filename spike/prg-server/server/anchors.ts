import type { Anchor, ResolvedAnchor } from "../shared/messages";
import type { Hunk, HunkLine, Layer, ReviewFile } from "../shared/payload";
import { flat } from "./format";
import type { Review } from "./review";

const CODE_LIMIT = 4000;
const QUOTED_LINES = 12;
const STACK_KINDS: Record<string, string> = {
  churn: "rewritten further up",
  placement: "belongs in another layer",
  order: "needs a later layer",
  description: "description",
};

const clip = (text: string, limit = 160) => (text.length > limit ? `${text.slice(0, limit)}…` : text);
const oneLine = (text: string, limit = 160) => clip(text.replace(/\s+/g, " ").trim(), limit);

type Side = "L" | "R";
const numberOn = (row: HunkLine, side: Side) => (side === "L" ? row[1] : row[2]);

// The rows of a hunk that have a number on this side: the base's lines on L, the head's on R.
const rowsOn = (lines: HunkLine[], side: Side) => lines.filter(row => (side === "L" ? row[0] !== "+" : row[0] !== "-"));

// A note can sit on a removed line or on any line of the head.
const canAnchor = (lines: HunkLine[], side: Side, n: number) =>
  lines.some(([sign, oldNo, newNo]) => (side === "L" ? sign === "-" && oldNo === n : newNo === n));

// The rows a line anchor quotes, or null when it can't sit there: removed lines of its hunk on the base side; on the
// head side lines of its hunk or, from the file's text, unchanged lines outside every hunk, as an expanded gap shows.
function lineRows(file: ReviewFile, hunk: Hunk, side: Side, from: number, to: number, text: string[] | undefined): HunkLine[] | null {
  if (to < from) {
    return null;
  }
  if (side === "L") {
    if (!canAnchor(hunk.lines, side, from) || !canAnchor(hunk.lines, side, to)) {
      return null;
    }
    return rowsOn(hunk.lines, side).filter(row => row[1] !== null && row[1] >= from && row[1] <= to);
  }
  const own = new Map(rowsOn(hunk.lines, side).map(row => [row[2], row]));
  const count = text ? (file.lineCount ?? 0) : 0;
  if (!own.has(to) && to > count) {
    return null;
  }
  const changed = new Set(file.hunks.flatMap(h => rowsOn(h.lines, side).map(row => row[2])));
  const rows: HunkLine[] = [];
  for (let n = from; n <= to; n++) {
    const row = own.get(n) ?? (text && !changed.has(n) && n <= count ? ([" ", null, n, text[n - 1] ?? ""] as HunkLine) : undefined);
    if (!row) {
      return null;
    }
    rows.push(row);
  }
  return rows;
}

// How far a hunk's head lines are from line n.
function distance(hunk: Hunk, n: number) {
  const lines = rowsOn(hunk.lines, "R").map(row => row[2] as number);
  const first = lines[0] ?? hunk.newStart;
  const last = lines.at(-1) ?? hunk.newStart;
  return n < first ? first - n : n > last ? n - last : 0;
}

function numbered(rows: HunkLine[], side: Side | null) {
  const shown = rows.slice(0, QUOTED_LINES);
  const width = Math.max(...shown.map(row => String(row[2] ?? row[1] ?? "").length), 1);
  const lines = shown.map(row => {
    const no = side ? numberOn(row, side) : row[0] === "-" ? row[1] : row[2];
    return `${String(no ?? "").padStart(width)} ${row[0]} ${clip(row[3], 240)}`;
  });
  if (rows.length > shown.length) {
    lines.push(`(and ${rows.length - shown.length} more lines)`);
  }
  return lines.join("\n");
}

function hunkRange(hunk: Hunk) {
  const news = hunk.lines.map(row => row[2]).filter(n => n !== null);
  if (news.length > 0) {
    return `R${news[0]}-R${news.at(-1)}`;
  }
  const olds = hunk.lines.map(row => row[1]).filter(n => n !== null);
  return `L${olds[0] ?? hunk.oldStart}-L${olds.at(-1) ?? hunk.oldStart}`;
}

// The layer's head as the skill's locations write it, and the "#12 " a stack puts in front of each.
function context(review: Review, layer: Layer) {
  return { at: review.stacked ? `#${layer.id} ` : "", sha: `@${(layer.meta.headSha ?? "").slice(0, 7)}` };
}

// "src/a.ts:R1-R9@abc1234 (f3h1)" for each hunk a claim or section names; "1014:f3h2" names another layer's.
function hunkLocations(review: Review, layer: Layer, ids: string[]) {
  return ids.slice(0, 10).map(ref => {
    const [, other, id] = /^(?:(\d+):)?(.+)$/.exec(ref) ?? [];
    const owner = other ? review.layer(Number(other)) : layer;
    const file = owner?.files.find(f => f.hunks.some(h => h.id === id));
    const hunk = file?.hunks.find(h => h.id === id);
    if (!owner || !file || !hunk) {
      return ref;
    }
    const { at, sha } = context(review, owner);
    return `${at}${file.path}:${hunkRange(hunk)}${sha} (${hunk.id})`;
  });
}

// Null when the anchor names something this review doesn't have. Paths, code and labels come from the payload,
// never from the page.
export function resolveAnchor(review: Review, anchor: Anchor): ResolvedAnchor | null {
  const found = (
    label: string | null,
    more: { detail?: string | null; path?: string | null; code?: string | null; loc?: string | null; match?: string | null } = {},
  ): ResolvedAnchor => ({
    ...anchor,
    label: label === null ? null : flat(label),
    detail: more.detail ?? null,
    path: more.path ?? null,
    code: more.code ?? null,
    loc: more.loc ? flat(more.loc) : null,
    match: more.match ?? null,
  });

  if (anchor.kind === "general") {
    const layer = anchor.layer === undefined ? undefined : review.layer(anchor.layer);
    if (anchor.layer !== undefined && !layer) {
      return null;
    }
    return found(layer && review.stacked ? `#${layer.id} as a whole` : null);
  }
  if (anchor.kind === "stackIssue") {
    const issue = review.response.stack?.check?.issues[anchor.index];
    if (!issue) {
      return null;
    }
    const kind = STACK_KINDS[issue.kind] ?? "other";
    const layers = issue.layers.map(n => `#${n}`).join(", ");
    const prose = `${issue.problem} ${issue.fix ?? ""}`;
    const links = [...new Set([...prose.matchAll(/\]\(((?:\d+:)?f\d+h\d+)\)/g)].map(m => m[1] as string))];
    const top = review.response.layers.at(-1);
    const where = top ? hunkLocations(review, top, links).map((loc, i) => `${links[i]} is ${loc}`) : [];
    return found(`the stack issue (${kind}${layers ? `, ${layers}` : ""}) "${oneLine(issue.problem, 200)}"`, {
      detail: [
        issue.problem.length > 200 ? clip(issue.problem, 1200) : "",
        issue.fix ? `Suggested fix: ${clip(issue.fix, 800)}` : "",
        where.length ? `Where: ${where.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      match: issue.problem,
    });
  }

  const layer = review.layer(anchor.layer);
  if (!layer) {
    return null;
  }
  const { at, sha } = context(review, layer);
  const fileOf = (id: string) => layer.files.find(f => f.id === id);

  switch (anchor.kind) {
    case "line": {
      const file = fileOf(anchor.file);
      const hunk = file?.hunks.find(h => h.id === anchor.hunk);
      const end = anchor.endLine ?? anchor.line;
      const rows = file && hunk ? lineRows(file, hunk, anchor.side, anchor.line, end, review.text(layer.id, file.id)) : null;
      if (!file || !rows) {
        return null;
      }
      const code = rows
        .map(row => row[3])
        .join("\n")
        .slice(0, CODE_LIMIT);
      const range = end !== anchor.line ? `${anchor.side}${anchor.line}-${anchor.side}${end}` : `${anchor.side}${anchor.line}`;
      const loc = `${at}${file.path}:${range}${sha}`;
      return found(`${loc} | ${oneLine(rows[0]?.[3] ?? "")}`, { detail: numbered(rows, anchor.side), path: file.path, code, loc });
    }
    case "hunk": {
      const file = fileOf(anchor.file);
      const hunk = file?.hunks.find(h => h.id === anchor.hunk);
      if (!file || !hunk) {
        return null;
      }
      const loc = `${at}${file.path}:${hunkRange(hunk)}${sha}`;
      const changed = hunk.lines.filter(row => row[0] !== " ");
      return found(`the hunk ${loc} (${hunk.id})${hunk.header ? ` in ${oneLine(hunk.header, 80)}` : ""}`, {
        detail: numbered(changed, null),
        path: file.path,
        loc,
        match: hunk.sig,
      });
    }
    case "file": {
      const file = fileOf(anchor.file);
      if (!file) {
        return null;
      }
      const renamed = file.status === "renamed" ? `, from ${file.oldPath}` : "";
      return found(`the file ${at}${file.path}${sha} (${file.status}${renamed}, +${file.additions} -${file.deletions})`, {
        detail: file.hunks.length ? `hunks at ${file.hunks.map(h => `${hunkRange(h)} (${h.id})`).join(", ")}` : null,
        path: file.path,
        loc: `${at}${file.path}${sha}`,
        match: file.path,
      });
    }
    case "section": {
      const section = layer.sections[anchor.index];
      if (!section) {
        return null;
      }
      const hunks = section.files.flatMap(part => part.hunks);
      return found(`${at}guide section ${anchor.index + 1}, "${section.title}"`, {
        detail: hunks.length ? `covers ${hunkLocations(review, layer, hunks).join(", ")}${hunks.length > 10 ? " and more" : ""}` : null,
        match: section.title,
      });
    }
    case "tell": {
      const file = fileOf(anchor.file);
      const tells = layer.tells.filter(t => t.file === anchor.file && t.line === anchor.line);
      const first = tells[0];
      if (!file || !first) {
        return null;
      }
      const loc = `${at}${file.path}:${anchor.line}${sha}`;
      return found(`${loc}, flagged as ${tells.map(t => t.label).join(", ")}`, {
        detail: clip(first.text, 400),
        path: file.path,
        code: first.text,
        loc,
        match: `${first.kind}\n${first.text}`,
      });
    }
    case "annotation": {
      const note = layer.annotations[anchor.index];
      if (!note) {
        return null;
      }
      const loc = note.row ? `${at}${note.path}:${note.row}${sha}` : `${at}${note.path}:${note.line}`;
      const link = note.link?.startsWith("https://") ? `\n${note.link}` : "";
      return found(`${loc}, CI ${note.level} from ${note.check}${note.row ? "" : " (on a line this PR doesn't change)"}`, {
        detail: `${clip(`${note.title ? `${note.title}: ` : ""}${note.message}`, 800)}${link}`,
        path: note.path,
        loc,
        match: `${note.path}\n${note.check}\n${note.title}\n${note.message}`,
      });
    }
    case "check":
      return found(`${at}the CI check "${anchor.name}"`, { match: anchor.name });
    case "claim": {
      const row = layer.descriptionCheck?.[anchor.list]?.[anchor.index];
      if (!row) {
        return null;
      }
      const text = "claim" in row ? row.claim : "what" in row ? row.what : row.ask;
      const what = {
        checklist: "a claim of the description that the diff carries out",
        unsupported: "a claim of the description that isn't in the diff",
        missing: "something the diff does that the description leaves out",
        issue: "something the linked issue asks for that isn't in the diff",
      }[anchor.list];
      const hunks = "hunks" in row && row.hunks ? row.hunks : [];
      const detail = [
        "why" in row && row.why ? `Why: ${clip(row.why, 600)}` : "",
        hunks.length ? `In ${hunkLocations(review, layer, hunks).join(", ")}` : "",
        row.stack ? `Stack note: ${clip(row.stack, 400)}` : "",
      ].filter(Boolean);
      return found(`${at}${what}: "${oneLine(text, 200)}"`, { detail: detail.join("\n") || null, match: text });
    }
  }
}

function nearest<T>(candidates: T[], distance: (item: T) => number): T | undefined {
  return candidates.toSorted((a, b) => distance(a) - distance(b))[0];
}

// The same lines of code on the same side of the same file, nearest to where they were: in a hunk, or failing that
// unchanged in the head's text and named on the nearest hunk that can hold them.
function findLines(file: ReviewFile, side: Side, code: string, near: number, text: string[] | undefined) {
  const want = code.split("\n");
  const found: { hunk: Hunk; from: number; to: number }[] = [];
  for (const hunk of file.hunks) {
    const rows = rowsOn(hunk.lines, side);
    for (let i = 0; i + want.length <= rows.length; i++) {
      const window = rows.slice(i, i + want.length);
      const from = numberOn(window[0] as HunkLine, side);
      const to = numberOn(window.at(-1) as HunkLine, side);
      if (from !== null && to !== null && window.every((row, j) => row[3] === want[j])) {
        if (canAnchor(hunk.lines, side, from) && canAnchor(hunk.lines, side, to)) {
          found.push({ hunk, from, to });
        }
      }
    }
  }
  if (found.length === 0 && side === "R" && text) {
    for (let i = 0; i + want.length <= (file.lineCount ?? 0); i++) {
      if (want.every((line, j) => text[i + j] === line)) {
        const [from, to] = [i + 1, i + want.length];
        const hunk = file.hunks
          .toSorted((a, b) => distance(a, from) - distance(b, from))
          .find(h => lineRows(file, h, side, from, to, text));
        if (hunk) {
          found.push({ hunk, from, to });
        }
      }
    }
  }
  return nearest(found, hit => Math.abs(hit.from - near));
}

// Where a review's finding goes: on its line when the diff can show it, else on its file, else on the PR as a whole.
export function findingAnchor(review: Review, layerId: number, path: string, line?: number): ResolvedAnchor | null {
  const file = review.layer(layerId)?.files.find(f => f.path === path.replace(/^\.\//, ""));
  if (file && line) {
    const hunk = nearest(file.hunks, h => distance(h, line));
    const at = hunk && resolveAnchor(review, { kind: "line", layer: layerId, file: file.id, hunk: hunk.id, side: "R", line });
    if (at) {
      return at;
    }
  }
  return resolveAnchor(review, file ? { kind: "file", layer: layerId, file: file.id } : { kind: "general", layer: layerId });
}

// After a reload, the same thing in the new payload, found by what it says rather than by its ids, which a rebuild
// renumbers. Anything not found keeps what it had and is marked outdated.
export function reanchor(review: Review, old: ResolvedAnchor): ResolvedAnchor {
  const again = findAgain(review, old);
  return (again && resolveAnchor(review, again)) ?? { ...old, outdated: true };
}

function findAgain(review: Review, old: ResolvedAnchor): Anchor | null {
  if (old.kind === "general") {
    return old.layer === undefined ? { kind: "general" } : { kind: "general", layer: old.layer };
  }
  if (old.kind === "stackIssue") {
    const index = review.response.stack?.check?.issues.findIndex(issue => issue.problem === old.match) ?? -1;
    return index >= 0 ? { kind: "stackIssue", index } : null;
  }
  const layer = review.layer(old.layer);
  if (!layer) {
    return null;
  }
  const file = old.path === null ? undefined : layer.files.find(f => f.path === old.path);
  const base = { layer: layer.id };
  switch (old.kind) {
    case "line": {
      const hit = file && old.code !== null ? findLines(file, old.side, old.code, old.line, review.text(layer.id, file.id)) : undefined;
      if (!file || !hit) {
        return null;
      }
      return {
        kind: "line",
        ...base,
        file: file.id,
        hunk: hit.hunk.id,
        side: old.side,
        line: hit.from,
        ...(hit.to !== hit.from && { endLine: hit.to }),
      };
    }
    case "hunk": {
      const hunk = file?.hunks.find(h => h.sig === old.match);
      return file && hunk ? { kind: "hunk", ...base, file: file.id, hunk: hunk.id } : null;
    }
    case "file":
      return file ? { kind: "file", ...base, file: file.id } : null;
    case "section": {
      const index = layer.sections.findIndex(section => section.title === old.match);
      return index >= 0 ? { kind: "section", ...base, index } : null;
    }
    case "tell": {
      const near = Number(old.line.slice(1));
      const side = old.line[0];
      const tell = nearest(
        layer.tells.filter(t => t.file === file?.id && t.line[0] === side && `${t.kind}\n${t.text}` === old.match),
        t => Math.abs(Number(t.line.slice(1)) - near),
      );
      return file && tell ? { kind: "tell", ...base, file: file.id, line: tell.line } : null;
    }
    case "annotation": {
      const index = layer.annotations.findIndex(a => `${a.path}\n${a.check}\n${a.title}\n${a.message}` === old.match);
      return index >= 0 ? { kind: "annotation", ...base, index } : null;
    }
    case "check":
      return { kind: "check", ...base, name: old.name };
    case "claim": {
      const rows = layer.descriptionCheck?.[old.list] ?? [];
      const index = rows.findIndex(row => ("claim" in row ? row.claim : "what" in row ? row.what : row.ask) === old.match);
      return index >= 0 ? { kind: "claim", ...base, list: old.list, index } : null;
    }
  }
}
