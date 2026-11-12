import { z } from "zod";

import { NOTE_INTENTS, type NoteIntent } from "./intents";
import { DISMISS_REASONS, type DismissReason, REVIEW_EFFORTS, type ReviewEffort, SEVERITIES, type Severity } from "./reviews";

const layer = z.number().int().min(0).max(999_999_999);
const fileId = z.string().regex(/^f\d{1,6}$/);
const hunkId = z.string().regex(/^f\d{1,6}h\d{1,6}$/);
const index = z.number().int().min(0).max(100_000);
const lineNo = z.number().int().positive();
const messageId = z.string().regex(/^m\d{1,9}$/);

// What a message is about. The server checks each one against the payload and quotes the code itself.
export const anchorSchema = z.discriminatedUnion("kind", [
  // A line, or with endLine a range on the same side of one hunk. side L numbers in the base, R in the head.
  z.object({
    kind: z.literal("line"),
    layer,
    file: fileId,
    hunk: hunkId,
    side: z.enum(["L", "R"]),
    line: lineNo,
    endLine: lineNo.optional(),
  }),
  z.object({ kind: z.literal("hunk"), layer, file: fileId, hunk: hunkId }),
  z.object({ kind: z.literal("file"), layer, file: fileId }),
  // index into layer.sections, from 0.
  z.object({ kind: z.literal("section"), layer, index }),
  // A flagged line: the file and the tell's line, "R12" or "L3".
  z.object({ kind: z.literal("tell"), layer, file: fileId, line: z.string().regex(/^[LR]\d{1,7}$/) }),
  // index into layer.annotations.
  z.object({ kind: z.literal("annotation"), layer, index }),
  // A CI check by name, one line of text. Checks are live, so the server says what it knows of it rather than refusing.
  z.object({
    kind: z.literal("check"),
    layer,
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^\p{Cc}]+$/u),
  }),
  // One finding of the description check: list names the array in layer.descriptionCheck, index the row.
  z.object({ kind: z.literal("claim"), layer, list: z.enum(["checklist", "unsupported", "missing", "issue"]), index }),
  // index into layer.try.
  z.object({ kind: z.literal("try"), layer, index }),
  // index into stack.check.issues.
  z.object({ kind: z.literal("stackIssue"), index }),
  // Nothing in particular, optionally while looking at one layer.
  z.object({ kind: z.literal("general"), layer: layer.optional() }),
]);

export type Anchor = z.infer<typeof anchorSchema>;
export type AnchorKind = Anchor["kind"];
export type LineAnchor = Extract<Anchor, { kind: "line" }>;

// An anchor as the server found it in the payload; label is null for general.
export type ResolvedAnchor = Anchor & {
  label: string | null;
  // The lines the session gets under the label: numbered code, a section's files, a claim's reason.
  detail: string | null;
  path: string | null;
  code: string | null;
  // The skill's location, "src/a.ts:R12@abc1234", with "#12 " in front on a stack.
  loc: string | null;
  // What a reload looks for to find the same thing again; outdated when it found nothing.
  match: string | null;
  outdated?: boolean;
};

// What the session says it did with a thread. done, answered and declined settle it, and the page folds it away.
export const NOTE_STATES = ["open", "working", "done", "answered", "declined"] as const;
export type NoteState = (typeof NOTE_STATES)[number];
export const settled = (state: NoteState) => state === "done" || state === "answered" || state === "declined";

// What happened on a thread between its messages: a step Claude took, or a note such as a change of state.
export type ThreadEvent = { kind: "step" | "note"; text: string; at: string };

// Something Claude wants answered, with the choices it offers; the answer comes back as a follow-up.
export const questionSchema = z.object({
  question: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(6),
  multiple: z.boolean().optional(),
});
export type Question = z.infer<typeof questionSchema>;

export type Message = {
  id: string;
  from: "user" | "claude";
  // A note is held as a draft until the batch is sent; chat goes at once.
  kind: "chat" | "note";
  text: string;
  // A reply and a follow-up carry their thread's anchor.
  anchor: ResolvedAnchor;
  replyTo?: string;
  status: "draft" | "sent" | "delivered";
  // Kept on a thread's first message.
  state: NoteState;
  resolved: boolean;
  // The user put the thread away; the page hides it until they bring it back or follow up.
  archived?: boolean;
  // On a thread's first message: the id of the last message in it the user has had on screen.
  seen?: string;
  // On a thread's first message: the steps Claude took and notes on what became of it, in the order they happened.
  events?: ThreadEvent[];
  // On a message from Claude: questions it wants answered before it goes on.
  ask?: Question[];
  // On the threads of a review the user asked Claude for: its number, on the request and on each finding.
  review?: {
    n: number;
    // On the request: the effort, and every hunk's signature at the time.
    effort?: ReviewEffort;
    sigs?: string[];
    // On a finding: what Claude says of it, and the change it proposes.
    severity?: Severity;
    recommended?: boolean;
    patch?: string;
    // The head it was last checked against, whether an earlier review read the same code, and why the user dismissed it.
    seen?: string;
    missed?: boolean;
    dismissed?: DismissReason;
  };
  // On a note, when the user said what it asks for.
  intent?: NoteIntent;
  // Which send took this note, from 1, and when.
  batch?: number;
  sentAt?: string;
  // Put on the pull request as a review comment; pending until submitted on GitHub.
  posted?: { at: string; pending: boolean; url: string | null };
  at: string;
  edited?: string;
};

export const newMessageSchema = z.object({
  kind: z.enum(["chat", "note"]),
  text: z.string().trim().min(1).max(4000),
  // Left out means general; ignored on a follow-up, which takes its thread's.
  anchor: anchorSchema.optional(),
  replyTo: messageId.optional(),
  // Kept on a note only.
  intent: z.enum(NOTE_INTENTS).optional(),
});

export const editSchema = z.object({ text: z.string().trim().min(1).max(4000) });
// reason says why a review finding is being put away.
export const archiveSchema = z.object({ archived: z.boolean(), reason: z.enum(DISMISS_REASONS).optional() });
export const reviewRequestSchema = z.object({ layer, effort: z.enum(REVIEW_EFFORTS) });
// What the code-review skill reports for each finding, plus whether Claude says to act on it.
export const findingsSchema = z.object({
  findings: z
    .array(
      z.object({
        file: z.string().trim().min(1).max(500),
        line: z.union([z.number(), z.string()]).nullish(),
        summary: z.string().trim().min(1).max(2000),
        failure_scenario: z.string().trim().max(4000).nullish(),
        severity: z.enum(SEVERITIES).optional(),
        recommended: z.boolean().optional(),
        // The change Claude proposes, as a few lines of unified diff.
        patch: z.string().max(3000).nullish(),
      }),
    )
    .max(40),
});
export type Finding = z.infer<typeof findingsSchema>["findings"][number];

// Reviewed ticks, by the page's own keys.
export const ticksSchema = z.object({ keys: z.array(z.string().min(1).max(1000)).max(500), done: z.boolean() });

// Text, a state, or both. A state needs replyTo, and declining needs the reason as text.
export const replySchema = z
  .object({
    text: z.string().trim().min(1).max(8000).optional(),
    replyTo: messageId.optional(),
    state: z.enum(NOTE_STATES).optional(),
    resolved: z.boolean().optional(),
    ask: z.array(questionSchema).min(1).max(4).optional(),
  })
  .refine(r => r.ask === undefined || (r.text !== undefined && r.replyTo !== undefined), "questions need text and replyTo")
  .refine(r => r.text !== undefined || r.state !== undefined || r.resolved !== undefined, "send text, a state or both")
  .refine(r => (r.state === undefined && r.resolved === undefined) || r.replyTo !== undefined, "a state needs replyTo")
  .refine(r => r.state !== "declined" || r.text !== undefined, "say why in text when declining");

// What the session says it is doing, in a line. An empty line says it has stopped.
export const activitySchema = z.object({ text: z.string().max(400), replyTo: messageId.optional() });
// thread is the first message of the thread the work is for, when the session named one.
export type Activity = { text: string; thread: string | null; at: string };
export type SessionInfo = { listening: boolean; activity: Activity | null };

export type NewMessage = z.infer<typeof newMessageSchema>;
export type Reply = z.infer<typeof replySchema>;

// What the page's socket says changed; the page refetches it.
export type Push = { type: "review" | "messages" | "session" | "github" | "ticks"; layer?: number };
