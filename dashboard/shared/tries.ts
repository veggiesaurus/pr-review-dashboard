import type { Message } from "./messages";

// What became of a step Claude tried by hand. blocked: it couldn't be done from the session.
export const TRIED = ["passed", "failed", "blocked"] as const;
export type Tried = (typeof TRIED)[number];
// What the page sends to have a step tried, and how such a request is known again.
export const TRY_TEXT = "Try this and show what happened.";

// The owner's request to try a step, not yet answered. A guest typing the same words has asked for nothing.
export const awaitsTry = (m: Message) =>
  !m.replyTo &&
  m.from === "user" &&
  m.author?.role !== "guest" &&
  m.text === TRY_TEXT &&
  !m.archived &&
  (m.state === "open" || m.state === "working");
