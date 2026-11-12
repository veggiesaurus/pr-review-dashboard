import type { Layer, ReviewResponse } from "shared/payload";
import { formattingOnly, hits } from "src/components/guide/visible";
import { clearFlash, findTarget, parseTarget, reveal, type Tab, type Target } from "src/utils/anchors";
import { indexLayer } from "src/utils/payload";
import { create } from "zustand";

export type Layout = "unified" | "split";
// Which part of the change to show: all of it, what is new since the last build, or one commit's hunks (by index
// into meta.commits).
export type Show = { kind: "all" } | { kind: "fresh" } | { kind: "commit"; index: number };

type ViewState = {
  // The shown layer's id; null until the review has loaded.
  layer: number | null;
  tab: Tab;
  layout: Layout;
  // Formatting-only changes shown, dimmed.
  formatting: boolean;
  show: Show;
  // The payload, so a jump can tell whether the filter or the formatting switch hides its target.
  review: ReviewResponse | null;
  keysOpen: boolean;
  // What the URL points at within the layer, so the address can be shared: the last file, hunk or line jumped to.
  anchor: string | null;
  // The Go to a file or section picker, when open.
  jump: "file" | "section" | "usages" | null;
  setReview: (review: ReviewResponse | null) => void;
  // keepScroll leaves the page where it is, for a switch made from a list the reader is looking at.
  setLayer: (layer: number, keepScroll?: boolean) => void;
  setTab: (tab: Tab) => void;
  setLayout: (layout: Layout) => void;
  setFormatting: (formatting: boolean) => void;
  setShow: (show: Show) => void;
  setKeysOpen: (open: boolean) => void;
  setAnchor: (anchor: string | null) => void;
  setJump: (jump: "file" | "section" | "usages" | null) => void;
  // Switches to the target's layer and tab, then scrolls to it once it is drawn. target is any form parseTarget reads;
  // section is the section the jump comes from, which picks the card of a file split across sections.
  goTo: (layer: number | null, target: string, section?: number) => void;
};

// The template's keys, so the choice reads the same.
const LAYOUT_KEY = "prg:view";
const FORMATTING_KEY = "prg:fmt";
const ALL: Show = { kind: "all" };

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked; the choice lasts this visit.
  }
}

function targetHit(layer: Layer, target: Target, show: Show) {
  const { hunks, files } = indexLayer(layer);
  if (target.hunk) {
    const found = hunks.get(target.hunk);
    return !found || hits(found.hunk, show);
  }
  const ids = target.file
    ? (files.get(target.file)?.hunks.map(hunk => hunk.id) ?? [])
    : target.section !== undefined
      ? (layer.sections[target.section]?.files.flatMap(part => part.hunks) ?? [])
      : [];
  return (
    ids.length === 0 ||
    ids.some(id => {
      const found = hunks.get(id);
      return found ? hits(found.hunk, show) : false;
    })
  );
}

// Whether the target only shows with formatting on: in the Guide, inside the formatting section; in the Diff tab,
// in a file whose every hunk is formatting.
function formattingHides(layer: Layer, target: Target, tab: Tab) {
  const { files, owner, hunks } = indexLayer(layer);
  const file = target.file ? files.get(target.file) : undefined;
  if (tab === "diff") {
    const hunk = target.hunk ? hunks.get(target.hunk)?.hunk : undefined;
    return hunk ? Boolean(hunk.noise) : file ? formattingOnly(file) : false;
  }
  const kind = (index: number | undefined) => (index === undefined ? undefined : layer.sections[index]?.kind);
  if (target.section !== undefined) {
    return kind(target.section) === "formatting";
  }
  if (target.hunk) {
    return kind(owner.get(target.hunk)) === "formatting";
  }
  const homes = layer.sections.filter(section => section.files.some(part => part.id === target.file));
  return homes.length > 0 && homes.every(section => section.kind === "formatting");
}

const smooth = (): ScrollBehavior => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

// A section scrolls to its top, as the template's index links do; anything smaller is centred and flashed.
function revealWhenDrawn(layer: number, target: Target, wait: boolean, section?: number) {
  const until = performance.now() + 3000;
  const look = () => {
    const element = findTarget(layer, target, section);
    if (!element) {
      if (performance.now() < until) {
        requestAnimationFrame(look);
      }
    } else if (target.section !== undefined) {
      element.scrollIntoView({ behavior: smooth(), block: "start" });
    } else {
      // A card folded by its tick opens, as the template's reveal does; a line or hunk opens the details it is in.
      const body = element.matches("[data-card]") ? element.querySelector(":scope > details") : null;
      if (body instanceof HTMLDetailsElement) {
        body.open = true;
      }
      reveal(element);
    }
  };
  requestAnimationFrame(wait ? () => requestAnimationFrame(look) : look);
}

// The page's column: the window's width, less room for the section rail at the left edge. It is the same on every tab
// and in both layouts, so the tabs and the layout switch stay under the pointer.
export const PAGE_COLUMN = "mx-auto max-w-[160rem] px-4 min-[80rem]:px-12";

export const useViewStore = create<ViewState>((set, get) => ({
  layer: null,
  tab: "overview",
  layout: read(LAYOUT_KEY) === "split" ? "split" : "unified",
  formatting: read(FORMATTING_KEY) === "show",
  show: ALL,
  review: null,
  keysOpen: false,
  anchor: null,
  jump: null,
  setReview: review => set({ review }),
  setLayer: (layer, keepScroll = false) => {
    if (get().layer !== layer) {
      clearFlash();
      set({ layer, show: ALL, anchor: null });
      // Another layer is another page, so it opens at its top.
      if (!keepScroll) {
        window.scrollTo({ top: 0 });
      }
    }
  },
  setTab: tab => {
    if (get().tab !== tab) {
      set({ tab, anchor: null });
      window.scrollTo({ top: 0 });
    }
  },
  setAnchor: anchor => set({ anchor }),
  setLayout: layout => {
    write(LAYOUT_KEY, layout);
    set({ layout });
  },
  setFormatting: formatting => {
    write(FORMATTING_KEY, formatting ? "show" : "hide");
    set({ formatting });
  },
  setShow: show => set({ show }),
  setKeysOpen: keysOpen => set({ keysOpen }),
  setJump: jump => set({ jump, keysOpen: false }),
  goTo: (layer, text, section) => {
    const target = parseTarget(text);
    const to = target?.layer ?? layer ?? get().layer;
    if (!target || to === null) {
      return;
    }
    const before = get();
    get().setLayer(to);
    const { review, show, formatting } = get();
    const shown = review?.layers.find(l => l.id === to);
    const guide = !shown || shown.sections.length > 0;
    const tab: Tab = guide && (target.section !== undefined || before.tab !== "diff") ? "guide" : "diff";
    const patch: Partial<ViewState> = { tab, anchor: text.replace(/^\d+:/, "") };
    if (shown && show.kind !== "all" && !targetHit(shown, target, show)) {
      patch.show = ALL;
    }
    // Shown for this jump only: the stored choice stays as it was.
    if (shown && !formatting && formattingHides(shown, target, tab)) {
      patch.formatting = true;
    }
    set(patch);
    const sameLayer = target.layer === null || target.layer === layer;
    revealWhenDrawn(to, target, before.layer !== to || before.tab !== tab, tab === "guide" && sameLayer ? section : undefined);
  },
}));
