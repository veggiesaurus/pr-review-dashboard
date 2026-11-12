import type { Anchor, LineAnchor } from "shared/messages";

import { settleLayout } from "src/utils/motion";

export const TABS = ["overview", "guide", "diff"] as const;
export type Tab = (typeof TABS)[number];

// A jump target as guide prose, the ready check and links write it: s2 (a section, from 1), f3 (a file), f3h2 (a
// hunk), f3:R12 or f3:L4 (a line), each optionally behind the layer, as 1013:f42h1.
export type Target = { layer: number | null; section?: number; file?: string; hunk?: string; line?: string };

const TARGET = /^(?:(\d+):)?(?:s(\d+)|(f\d+)(h\d+)?(?::([LR]\d+))?)$/;

export function parseTarget(text: string): Target | null {
  const match = TARGET.exec(text);
  if (!match) {
    return null;
  }
  const [, layer, section, file, hunk, line] = match;
  const target: Target = { layer: layer ? Number(layer) : null };
  if (section) {
    target.section = Number(section) - 1;
  }
  if (file) {
    target.file = file;
  }
  if (file && hunk) {
    target.hunk = file + hunk;
  }
  if (line) {
    target.line = line;
  }
  return target;
}

// Element ids. Only the shown tab is in the page, so a hunk or line has one element; a file split across sections
// has a card in each, so a card's id names its section when it is in one.
export const sectionElementId = (layer: number, index: number) => `l${layer}-s${index + 1}`;
export const cardElementId = (layer: number, file: string, section?: number) =>
  section === undefined ? `l${layer}-${file}` : `l${layer}-s${section + 1}-${file}`;
export const hunkElementId = (layer: number, hunk: string) => `l${layer}-${hunk}`;
// line is "R12" (new side) or "L4" (old side), as tells and annotations write it.
export const lineElementId = (layer: number, file: string, line: string) => `l${layer}-${file}-${line}`;
// Every card carries this, so a file target finds its first card in either tab.
export const cardDataAttribute = (layer: number, file: string) => `l${layer}-${file}`;

// Threads under a line are grouped by this, within one layer and file.
export const lineKey = (anchor: Pick<LineAnchor, "hunk" | "side" | "line" | "endLine">) =>
  `${anchor.hunk}:${anchor.side}:${anchor.endLine ?? anchor.line}`;

// One string per anchor, to tell whether two anchors are the same thing.
export function anchorKey(anchor: Anchor): string {
  switch (anchor.kind) {
    case "line":
      return `line:${anchor.layer}:${anchor.file}:${anchor.hunk}:${anchor.side}:${anchor.line}:${anchor.endLine ?? anchor.line}`;
    case "hunk":
      return `hunk:${anchor.layer}:${anchor.hunk}`;
    case "file":
      return `file:${anchor.layer}:${anchor.file}`;
    case "section":
    case "annotation":
    case "try":
      return `${anchor.kind}:${anchor.layer}:${anchor.index}`;
    case "tell":
      return `tell:${anchor.layer}:${anchor.file}:${anchor.line}`;
    case "check":
      return `check:${anchor.layer}:${anchor.name}`;
    case "claim":
      return `claim:${anchor.layer}:${anchor.list}:${anchor.index}`;
    case "stackIssue":
      return `stackIssue:${anchor.index}`;
    case "general":
      return `general:${anchor.layer ?? ""}`;
  }
}

// section is where the jump comes from, so a file split across sections lands on that section's card.
export function findTarget(layer: number, target: Target, section?: number): HTMLElement | null {
  const byId = (id: string) => document.getElementById(id);
  if (target.section !== undefined) {
    return byId(sectionElementId(layer, target.section));
  }
  if (!target.file) {
    return null;
  }
  const card = () => document.querySelector<HTMLElement>(`[data-card="${cardDataAttribute(layer, target.file ?? "")}"]`);
  if (target.line) {
    return byId(lineElementId(layer, target.file, target.line)) ?? (target.hunk ? byId(hunkElementId(layer, target.hunk)) : null) ?? card();
  }
  if (target.hunk) {
    return byId(hunkElementId(layer, target.hunk));
  }
  return (section === undefined ? null : byId(cardElementId(layer, target.file, section))) ?? card();
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;

// Marks the element a jump landed on for a moment. Any earlier mark goes first: React may since have reused that
// element for another row.
export function flash(element: HTMLElement, ms = 1600) {
  clearFlash();
  element.dataset.flash = "";
  flashTimer = setTimeout(() => delete element.dataset.flash, ms);
}

export function clearFlash() {
  clearTimeout(flashTimer);
  for (const marked of document.querySelectorAll<HTMLElement>("[data-flash]")) {
    delete marked.dataset.flash;
  }
}

// Opens the details an element sits in, brings it into view and flashes it.
export function reveal(element: HTMLElement) {
  for (let details = element.closest("details"); details; details = details.parentElement?.closest("details") ?? null) {
    details.open = true;
  }
  settleLayout();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  flash(element);
}

// After a switch of layer or tab the element isn't drawn yet, so this looks for it each frame for a while.
export function revealWhenReady(layer: number, target: Target, timeoutMs = 3000) {
  const until = performance.now() + timeoutMs;
  const look = () => {
    const element = findTarget(layer, target);
    if (element) {
      reveal(element);
    } else if (performance.now() < until) {
      requestAnimationFrame(look);
    }
  };
  requestAnimationFrame(look);
}

// The hash keeps the layer and tab, #12/guide, and may add a target, #12/guide/f3h1. A layer without a PR is 0.
// The template's own forms still work: #f3h1, #1013:f42h1, #p1013, and #p1013- followed by one of its element ids.
// section is the section a template card id names, for a file split across sections.
export type HashState = { layer?: number; tab?: Tab; target?: string; section?: number };

// The template's element ids as targets: s2, r-f3-R4 (a line), h-f3h1-s0 (a hunk) and c-0-f3 (a card in a section).
function templateTarget(id: string): Pick<HashState, "target" | "section"> | null {
  const line = /^r-(f\d+)-([LR]\d+)$/.exec(id);
  const hunk = /^h-(f\d+h\d+)-s\d+$/.exec(id);
  const card = /^c-(\d+)-(f\d+)$/.exec(id);
  if (line) {
    return { target: `${line[1]}:${line[2]}` };
  }
  if (hunk) {
    return { target: hunk[1] };
  }
  if (card) {
    return { target: card[2], section: Number(card[1]) };
  }
  return /^s\d+$/.test(id) ? { target: id } : null;
}

export function parseHash(hash: string): HashState {
  const text = decodeURIComponent(hash.replace(/^#/, ""));
  const full = /^(\d+)\/([a-z]+)(?:\/(.+))?$/.exec(text);
  if (full) {
    const tab = TABS.find(t => t === full[2]);
    return { layer: Number(full[1]), tab, target: full[3] && parseTarget(full[3]) ? full[3] : undefined };
  }
  const tab = TABS.find(t => t === text);
  if (tab) {
    return { tab };
  }
  const old = /^p(\d+)(?:-(.*)|$)/.exec(text);
  if (old) {
    return { layer: Number(old[1]), ...(old[2] ? templateTarget(old[2]) : null) };
  }
  const target = parseTarget(text);
  return target ? { layer: target.layer ?? undefined, target: text } : (templateTarget(text) ?? {});
}

// anchor is a target within the layer (f3, f3h2, s2, f3:R12), so a link can point at one file or line.
export const formatHash = (layer: number, tab: Tab, anchor?: string | null) => `#${layer}/${tab}${anchor ? `/${anchor}` : ""}`;
