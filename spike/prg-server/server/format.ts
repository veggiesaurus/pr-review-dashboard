import type { Message } from "../shared/messages";
import { DISMISS_TEXT } from "../shared/reviews";

const FRAME_LIMIT = 6000;
const NOTE_LIMIT = 2500;

// Every kind of line break becomes a newline first, so no line of quoted text can start at the margin.
const indent = (text: string, by = "  ") => text.replace(/\r\n?|[\v\f\u0085\u2028\u2029]/g, "\n").replace(/^/gm, by);

// Text from the PR (a path, a check's name) that goes on a line of its own in a frame can't be allowed to start another.
export const flat = (text: string) => text.replace(/[\p{Cc}\u2028\u2029]+/gu, " ");

function clip(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit)}\n(cut short: GET /api/messages has the rest)` : text;
}

// What a thread is about, in words the session can act on without the page: the location in the skill's form, then
// the quoted code or text, indented.
function about(message: Message) {
  const { anchor } = message;
  const outdated = anchor.outdated ? " (gone from the diff since a rebuild; this is where it was)" : "";
  const lines = [`about ${anchor.label ? flat(anchor.label) : "the review as a whole"}${outdated}`];
  if (anchor.detail) {
    lines.push(indent(anchor.detail, "    "));
  }
  return lines.join("\n");
}

// One frame is one notification in the session, so each carries the ids Claude needs to answer.
// finding is the review finding a follow-up answers, quoted so the session needn't remember what it wrote.
export function chatFrame(message: Message, scope: string, reopened = false, finding?: Message) {
  const follow = message.replyTo ? `, following up on ${message.replyTo}${reopened ? " (reopened)" : ""}` : "";
  const lines = [
    `[review page] chat ${message.id} on ${flat(scope)}${follow}`,
    about(message),
    ...(finding ? [indent(`the finding: ${clip(finding.text, 1200)}`, "    "), ...patchOf(finding, "its proposed patch")] : []),
    indent(message.text),
    `(answer with POST /api/replies {"replyTo":"${message.id}","text":"…"})`,
  ];
  return clip(lines.join("\n"), FRAME_LIMIT);
}

// A batch goes as one frame when it fits, else as parts that each fit and say how many there are.
export function notesFrames(notes: Message[], batch: number, scope: string) {
  const intro =
    `[review page] batch ${batch}: ${notes.length} ${notes.length === 1 ? "note" : "notes"} on ${flat(scope)}. ` +
    "Fix what they ask in the working tree and leave it unstaged; answer questions in the reply. " +
    'For each note, POST /api/replies {"replyTo":"<id>","state":"working"} when you start it, then ' +
    '{"replyTo":"<id>","state":"done"|"answered"|"declined","text":"what you did, the answer, or why not"}.' +
    (notes.some(note => note.intent)
      ? " A note marked (fix) wants the change made, (question) an answer and no change, (nit) the change only if it is trivial."
      : "");
  const items = notes.map(note =>
    clip(`${note.id}${note.intent ? ` (${note.intent})` : ""} ${about(note)}\n${indent(note.text)}`, NOTE_LIMIT),
  );
  const parts = [intro];
  for (const item of items) {
    const last = parts.length - 1;
    if ((parts[last] as string).length + item.length + 2 > FRAME_LIMIT) {
      parts.push(item);
    } else {
      parts[last] += `\n\n${item}`;
    }
  }
  if (parts.length === 1) {
    return parts;
  }
  return parts.map((part, i) =>
    i === 0
      ? part.replace(intro, `${intro} It comes in ${parts.length} parts.`)
      : `[review page] batch ${batch}, part ${i + 1} of ${parts.length}\n\n${part}`,
  );
}

const patchOf = (finding: Message, name: string) =>
  finding.review?.patch ? [indent(`${name}:\n${clip(finding.review.patch, 1200)}`, "    ")] : [];

// An earlier finding in a line, indented so nothing in it can start a line of the frame.
function brief(finding: Message) {
  const why = finding.review?.dismissed ? `(${DISMISS_TEXT[finding.review.dismissed].toLowerCase()}) ` : "";
  const where = finding.anchor.kind === "line" && finding.anchor.path ? `${finding.anchor.path}: ` : "";
  return `    - ${why}${flat(`${where}${finding.text.split("\n")[0]}`).slice(0, 240)}`;
}

// A review request names its target and says how the findings come back, since the page never sees the skill's report.
// before is what earlier reviews leave for this one: findings the user dismissed, and those still open on this PR.
export function reviewFrame(
  message: Message,
  scope: string,
  target: string,
  repo?: string,
  before: { dismissed: Message[]; open: Message[] } = { dismissed: [], open: [] },
) {
  const { n, effort } = message.review ?? { n: 0 };
  const lines = [
    `[review page] review ${n} requested on ${flat(scope)}, as chat ${message.id}`,
    about(message),
    `Run the code-review skill at ${effort} effort on ${flat(target)}${repo ? `, whose clone is ${flat(repo)}` : ""}: /code-review ${effort} ${flat(target)}`,
    "Don't pass --comment or --fix: nothing goes to GitHub, and the user picks what to fix on the page.",
    "If the clone has a REVIEW.md at its root, read it first and apply it to what you report and how severe you call it.",
    ...(before.dismissed.length
      ? [
          "The user dismissed these findings in earlier reviews of this repo. Drop any finding that repeats one, and say in your reply how many you dropped:",
          ...before.dismissed.map(brief),
        ]
      : []),
    ...(before.open.length
      ? ["These are still open from earlier reviews of this pull request, so don't report them again:", ...before.open.map(brief)]
      : []),
    `Then POST /api/reviews/${n}/findings {"findings":[{"file":"path from the repo's root","line":12,"summary":"…","failure_scenario":"…","severity":"high","recommended":true,"patch":"-old line\\n+new line"}]}`,
    'with every finding, most severe first, "severity" high, medium or low, "recommended" true on the ones worth acting on, and "patch" (a few lines of unified diff) only when the fix is that small (an empty list when there are none),',
    `and POST /api/replies {"replyTo":"${message.id}","state":"answered","text":"which findings to act on and why"}.`,
  ];
  return lines.join("\n");
}

const findingItem = (finding: Message) =>
  clip([`${finding.id} ${about(finding)}`, indent(finding.text), ...patchOf(finding, "proposed patch")].join("\n"), NOTE_LIMIT);

// Findings still open when the pull request gets a new head go back to the session to be looked at again.
export function recheckFrame(findings: Message[], scope: string) {
  const intro =
    `[review page] re-check ${findings.length} review ${findings.length === 1 ? "finding" : "findings"} on ${flat(scope)}: ` +
    "the pull request has a new head, and a fix may be in another file than the finding. For each, " +
    'POST /api/replies {"replyTo":"<id>","state":"done","text":"how it was fixed"} when it no longer holds, ' +
    'or {"replyTo":"<id>","text":"why it still holds"} when it does.';
  return clip([intro, ...findings.map(findingItem)].join("\n\n"), FRAME_LIMIT * 2);
}

// The findings the user asked to have fixed in one go, answered one by one as a batch of notes is.
export function fixFrame(findings: Message[], n: number, scope: string) {
  const intro =
    `[review page] fix ${findings.length} recommended ${findings.length === 1 ? "finding" : "findings"} of review ${n} on ${flat(scope)}. ` +
    "Fix each in the working tree and leave it unstaged. " +
    'For each, POST /api/replies {"replyTo":"<id>","state":"working"} when you start it, then ' +
    '{"replyTo":"<id>","state":"done"|"declined","text":"what you changed, or why not"}.';
  return clip([intro, ...findings.map(findingItem)].join("\n\n"), FRAME_LIMIT * 2);
}
