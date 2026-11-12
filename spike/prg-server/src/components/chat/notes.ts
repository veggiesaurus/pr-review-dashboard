import type { Anchor, AnchorKind, Message, NoteState, ResolvedAnchor } from "shared/messages";
import { noteOrder } from "shared/order";
import type { ReviewResponse } from "shared/payload";

import { plain } from "src/components/guide/visible";
import type { Tone } from "src/components/ui/badge";
import { useViewStore } from "src/store/view.store";
import { anchorKey, reveal } from "src/utils/anchors";

export const STATE_TEXT: Record<NoteState, string | null> = {
  open: null,
  working: "Working on it",
  done: "Done",
  answered: "Answered",
  declined: "Declined",
};

export const STATE_TONE: Record<NoteState, Tone> = {
  open: "outline",
  working: "warning",
  done: "success",
  answered: "success",
  declined: "neutral",
};

// The drawer lists threads under what they are about, in this order.
export const GROUPS: { name: string; kinds: AnchorKind[] }[] = [
  { name: "Lines", kinds: ["line", "tell"] },
  { name: "Files and hunks", kinds: ["hunk", "file"] },
  { name: "Guide sections", kinds: ["section"] },
  { name: "CI", kinds: ["annotation", "check"] },
  { name: "Description", kinds: ["claim"] },
  { name: "Things to try", kinds: ["try"] },
  { name: "Stack", kinds: ["stackIssue"] },
  { name: "The review as a whole", kinds: ["general"] },
];

// Anchors whose label is a location in the code, set in the mono face.
export const onCode = (anchor: ResolvedAnchor) => anchor.loc !== null;

// A thread's place in a list: its location without the commit for anything in the code, else the server's label.
export function shortLabel(anchor: ResolvedAnchor) {
  return anchor.loc ? anchor.loc.replace(/@[0-9a-f]*$/, "") : (anchor.label ?? "The review as a whole");
}

// Claude's text on one line, for a folded thread: no backticks, and a [phrase](f3h1) link as its phrase.
export const oneLine = (text: string) => text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replaceAll("`", "");

// What the page shows for an anchor nobody has written about yet, worked out from the payload.
export function describe(anchor: Anchor, review: ReviewResponse | undefined): string {
  const layer = "layer" in anchor && anchor.layer !== undefined ? review?.layers.find(l => l.id === anchor.layer) : undefined;
  const at = review?.stack && layer ? `#${layer.id} ` : "";
  const path = "file" in anchor ? layer?.files.find(f => f.id === anchor.file)?.path : undefined;
  switch (anchor.kind) {
    case "line": {
      const end = anchor.endLine ?? anchor.line;
      return `${at}${path ?? anchor.file}:${anchor.side}${anchor.line}${end !== anchor.line ? `-${anchor.side}${end}` : ""}`;
    }
    case "tell":
      return `${at}${path ?? anchor.file}:${anchor.line}, a flagged line`;
    case "hunk":
      return `${at}${path ?? anchor.file}, hunk ${anchor.hunk}`;
    case "file":
      return `${at}${path ?? anchor.file}`;
    case "section":
      return `${at}section ${anchor.index + 1}, "${layer?.sections[anchor.index]?.title ?? ""}"`;
    case "annotation": {
      const note = layer?.annotations[anchor.index];
      return note ? `${at}${note.path}:${note.line}, CI ${note.level} from ${note.check}` : "a CI annotation";
    }
    case "check":
      return `${at}the CI check "${anchor.name}"`;
    case "claim": {
      const row = layer?.descriptionCheck?.[anchor.list]?.[anchor.index];
      const text = row ? ("claim" in row ? row.claim : "what" in row ? row.what : row.ask) : "";
      return `${at}the description check: "${text}"`;
    }
    case "try":
      return `${at}a thing to try by hand: "${plain(layer?.try[anchor.index] ?? "")}"`;
    case "stackIssue":
      return `the stack issue "${plain(review?.stack?.check?.issues[anchor.index]?.problem ?? "")}"`;
    case "general":
      return at ? `${at}as a whole` : "The review as a whole";
  }
}

// The review as the skill's page names it in Copy notes.
export function scopeOf(review: ReviewResponse) {
  if (review.stack) {
    return `${review.stack.repo} ${review.layers.map(layer => `#${layer.id}`).join(", ")}, a stack`;
  }
  const meta = review.layers[0]?.meta;
  if (!meta) {
    return "this review";
  }
  const sha = meta.headSha.slice(0, 7);
  return meta.number ? `${meta.repo}#${meta.number} at ${sha}` : `${meta.repo} ${meta.head} at ${sha}`;
}

// The text Copy notes puts on the clipboard: the skill page's request, then each note under its location.
export function copyText(review: ReviewResponse, notes: Message[]) {
  const many = notes.length !== 1;
  const intro =
    `pr-review-guide: please work through ${many ? `these ${notes.length} review notes` : "this review note"} on ${scopeOf(review)}. ` +
    `${many ? "Each starts" : "It starts"} with its location. Fix what they ask in the working tree, leave it unstaged, and report back with one line per note.`;
  const where = (note: Message) =>
    `${note.anchor.loc ?? note.anchor.label ?? "The review as a whole"}${note.intent ? ` (${note.intent})` : ""}`;
  return [intro, ...notes.map(note => `${where(note)}\n${note.text.trim()}`)].join("\n\n");
}

// Notes in page order, the same as the session gets them in a batch.
export function pageOrder(review: ReviewResponse | undefined) {
  const order = noteOrder(review?.layers ?? []);
  return (a: Message, b: Message) => order(a.anchor, b.anchor) || Number(a.id.slice(1)) - Number(b.id.slice(1));
}

// Waits for an element the next render will draw, then brings it into view.
function revealSoon(find: () => HTMLElement | null, timeoutMs = 3000) {
  const until = performance.now() + timeoutMs;
  const look = () => {
    const element = find();
    if (element) {
      reveal(element);
    } else if (performance.now() < until) {
      requestAnimationFrame(look);
    }
  };
  requestAnimationFrame(look);
}

// Takes the page to what a thread is about: a line, hunk, file or section in the guide or diff, anything else
// to its row on Overview, found by the Ask Claude button that row carries.
export function jumpTo(anchor: Anchor, review: ReviewResponse | undefined): boolean {
  const view = useViewStore.getState();
  switch (anchor.kind) {
    case "line":
      view.goTo(anchor.layer, `${anchor.file}:${anchor.side}${anchor.endLine ?? anchor.line}`);
      return true;
    case "tell":
      view.goTo(anchor.layer, `${anchor.file}:${anchor.line}`);
      return true;
    case "hunk":
      view.goTo(anchor.layer, anchor.hunk);
      return true;
    case "file":
      view.goTo(anchor.layer, anchor.file);
      return true;
    case "section":
      view.goTo(anchor.layer, `s${anchor.index + 1}`);
      return true;
    case "general":
      return false;
  }
  if (anchor.kind === "annotation") {
    const note = review?.layers.find(l => l.id === anchor.layer)?.annotations[anchor.index];
    if (note?.file && note.row) {
      view.goTo(anchor.layer, `${note.file}:${note.row}`);
      return true;
    }
  }
  if ("layer" in anchor) {
    view.setLayer(anchor.layer);
  }
  view.setTab("overview");
  const key = anchorKey(anchor);
  revealSoon(() => {
    const button = document.querySelector<HTMLElement>(`[data-ask="${CSS.escape(key)}"]`);
    return button?.closest<HTMLElement>("li, tr, section") ?? button;
  });
  return true;
}
