import type { Hunk, Layer, ReviewFile, Section, SectionFile } from "shared/payload";
import type { Show } from "src/store/view.store";
import { indexLayer } from "src/utils/payload";

export function hits(hunk: Hunk, show: Show) {
  switch (show.kind) {
    case "fresh":
      return Boolean(hunk.fresh);
    case "commit":
      return (hunk.commits ?? []).includes(show.index);
    default:
      return true;
  }
}

// hit: the part's hunks the filter touches, every one of them when there is no filter.
export type ShownPart = SectionFile & { hit: string[] };
export type ShownSection = { index: number; section: Section; parts: ShownPart[] };
export type ShownFile = { file: ReviewFile; hit: string[] };

// The template's rules: under a filter only cards with a hunk it touches show, and only sections with such a card;
// the formatting section only while formatting is shown.
export function shownSections(layer: Layer, show: Show, formatting: boolean): ShownSection[] {
  const { hunks } = indexLayer(layer);
  const touched = (id: string) => {
    const hunk = hunks.get(id)?.hunk;
    return hunk ? hits(hunk, show) : false;
  };
  const out: ShownSection[] = [];
  for (const [index, section] of layer.sections.entries()) {
    if (section.kind === "formatting" && !formatting) {
      continue;
    }
    const parts = section.files
      .map(part => ({ ...part, hit: part.hunks.filter(touched) }))
      .filter(part => show.kind === "all" || part.hit.length > 0);
    if (parts.length) {
      out.push({ index, section, parts });
    }
  }
  return out;
}

// A file whose every hunk is formatting only; while formatting is hidden the Diff tab folds its card.
export const formattingOnly = (file: ReviewFile) => file.hunks.length > 0 && file.hunks.every(hunk => hunk.noise);

// Every file the filter touches; hit counts only the hunks its card shows.
export function shownFiles(layer: Layer, show: Show, formatting: boolean): ShownFile[] {
  return [...layer.files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(file => ({ file, touched: file.hunks.filter(hunk => hits(hunk, show)) }))
    .filter(({ touched }) => show.kind === "all" || touched.length > 0)
    .map(({ file, touched }) => ({ file, hit: touched.filter(hunk => formatting || !hunk.noise).map(hunk => hunk.id) }));
}

// Added and removed lines in the hunks a card shows; a file without hunks keeps git's own counts.
export function lineCounts(file: ReviewFile, hunkIds?: string[]) {
  if (!file.hunks.length || !hunkIds) {
    return { add: file.additions, del: file.deletions };
  }
  let add = 0;
  let del = 0;
  for (const hunk of file.hunks) {
    if (hunkIds.includes(hunk.id)) {
      for (const [sign] of hunk.lines) {
        add += sign === "+" ? 1 : 0;
        del += sign === "-" ? 1 : 0;
      }
    }
  }
  return { add, del };
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

// Guide text with its [phrase](target) links reduced to the phrase, for places that can't hold a link.
export const plain = (text: string) => text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const splitPath = (path: string) => {
  const at = path.lastIndexOf("/");
  return { name: path.slice(at + 1), dir: at < 0 ? "" : path.slice(0, at) };
};
