import type { Anchor, AnchorKind } from "shared/messages";
import { anchorKey } from "src/utils/anchors";
import { create } from "zustand";

// What the chat drawer shows: one thread, everything about one thing with a box to ask about it, or (null) the
// review as a whole.
export type Focus = { kind: "thread"; id: string } | { kind: "anchor"; anchor: Anchor } | null;

type ChatState = {
  // What the open composer is about; a line's composer opens under the line, any other in the drawer.
  composer: Anchor | null;
  chatOpen: boolean;
  drawer: "chat" | "notes";
  focus: Focus;
  // Drafts copied for pasting into the session, by id with the text copied, until cleared.
  copied: Record<string, string>;
  // Notes picked to post to GitHub.
  picked: string[];
  openComposer: (anchor: Anchor) => void;
  closeComposer: () => void;
  setChatOpen: (open: boolean) => void;
  openDrawer: (drawer: "chat" | "notes") => void;
  setFocus: (focus: Focus) => void;
  openThread: (id: string) => void;
  markCopied: (notes: { id: string; text: string }[]) => void;
  clearCopied: () => void;
  togglePicked: (id: string) => void;
  setPicked: (ids: string[]) => void;
};

const COMPOSER_KEY = "prg:composer";
const TEXT_KEY = "prg:compose:";

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Storage can be blocked; what is typed then lasts until a reload.
  }
}

// What was typed into a composer, kept in this browser as it is typed so a reload doesn't lose it.
export const composerText = (anchor: Anchor) => read(TEXT_KEY + anchorKey(anchor)) ?? "";
export const saveComposerText = (anchor: Anchor, text: string) => write(TEXT_KEY + anchorKey(anchor), text.trim() ? text : null);

const KINDS: AnchorKind[] = ["line", "hunk", "file", "section", "tell", "annotation", "check", "claim", "stackIssue", "general"];

// The composer that was open with something typed in it, reopened after a reload. The server checks the anchor
// again when the note is added, so a plain look at its shape is enough here.
function openedBefore(): Anchor | null {
  try {
    const saved: unknown = JSON.parse(read(COMPOSER_KEY) ?? "null");
    const anchor = saved && typeof saved === "object" && KINDS.includes((saved as Anchor).kind) ? (saved as Anchor) : null;
    return anchor && composerText(anchor) ? anchor : null;
  } catch {
    return null;
  }
}

const reopened = openedBefore();

const remember = (anchor: Anchor | null) => write(COMPOSER_KEY, anchor ? JSON.stringify(anchor) : null);

export const useChatStore = create<ChatState>(set => ({
  composer: reopened,
  chatOpen: reopened !== null && reopened.kind !== "line",
  drawer: "chat",
  focus: reopened && reopened.kind !== "line" ? { kind: "anchor", anchor: reopened } : null,
  copied: {},
  picked: [],
  openComposer: anchor => {
    remember(anchor);
    set(
      anchor.kind === "line"
        ? { composer: anchor }
        : { composer: anchor, chatOpen: true, drawer: "chat", focus: anchor.kind === "general" ? null : { kind: "anchor", anchor } },
    );
  },
  closeComposer: () => {
    remember(null);
    set({ composer: null });
  },
  setChatOpen: open => set({ chatOpen: open }),
  openDrawer: drawer => set({ chatOpen: true, drawer }),
  setFocus: focus => set({ focus }),
  openThread: id => set({ chatOpen: true, drawer: "chat", focus: { kind: "thread", id } }),
  markCopied: notes => set(state => ({ copied: { ...state.copied, ...Object.fromEntries(notes.map(n => [n.id, n.text])) } })),
  clearCopied: () => set({ copied: {} }),
  togglePicked: id => set(state => ({ picked: state.picked.includes(id) ? state.picked.filter(p => p !== id) : [...state.picked, id] })),
  setPicked: ids => set({ picked: ids }),
}));

export const openComposer = (anchor: Anchor) => useChatStore.getState().openComposer(anchor);
