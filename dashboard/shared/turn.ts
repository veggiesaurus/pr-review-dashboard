import type { Message } from "./messages";

// Who a thread waits on: Claude, the owner, one guest by id, or nobody.
export type Turn = "claude" | "owner" | number | null;

const writer = (message: Message): "owner" | number => (message.author?.role === "guest" ? message.author.id : "owner");

// Claude owes an answer while a person spoke to it last, and its question waits on whoever may answer it: the owner,
// or whoever started the thread. A post between people changes none of that; a mention is how one gets a person.
export function turnOf(root: Message, replies: Message[]): Turn {
  if (root.status === "draft" || root.archived || root.resolved) {
    return null;
  }
  const said = [root, ...replies].findLast(m => m.kind !== "post");
  if (!said) {
    return null;
  }
  if (root.state === "working" || said.from === "user") {
    return "claude";
  }
  if (!said.ask?.length) {
    return null;
  }
  return said.ask.some(question => question.owner) ? "owner" : writer(root);
}

// A person's thread nobody has settled and nothing is in hand for: Claude spoke last on it, as when it asked the
// owner before changing code for a guest.
export const leftOpen = (root: Message, replies: Message[]) =>
  root.from === "user" &&
  !root.review &&
  root.status !== "draft" &&
  root.state === "open" &&
  !root.archived &&
  replies.findLast(m => m.kind !== "post")?.from === "claude";

// The notes among them, which the owner can ask to have fixed in one go.
export const openNote = (root: Message, replies: Message[]) => root.kind === "note" && leftOpen(root, replies);
