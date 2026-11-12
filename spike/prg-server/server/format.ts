import type { Message } from "../shared/messages";

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
    ...(finding ? [indent(`the finding: ${clip(finding.text, 1200)}`, "    ")] : []),
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
    '{"replyTo":"<id>","state":"done"|"answered"|"declined","text":"what you did, the answer, or why not"}.';
  const items = notes.map(note => clip(`${note.id} ${about(note)}\n${indent(note.text)}`, NOTE_LIMIT));
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

// A review request names its target and says how the findings come back, since the page never sees the skill's report.
export function reviewFrame(message: Message, scope: string, target: string, repo?: string) {
  const { n, effort } = message.review ?? { n: 0 };
  const lines = [
    `[review page] review ${n} requested on ${flat(scope)}, as chat ${message.id}`,
    about(message),
    `Run the code-review skill at ${effort} effort on ${flat(target)}${repo ? `, whose clone is ${flat(repo)}` : ""}: /code-review ${effort} ${flat(target)}`,
    "Don't pass --comment or --fix: nothing goes to GitHub, and the user picks what to fix on the page.",
    `Then POST /api/reviews/${n}/findings {"findings":[{"file":"path from the repo's root","line":12,"summary":"…","failure_scenario":"…","severity":"high","recommended":true}]}`,
    'with every finding, most severe first, "severity" high, medium or low, and "recommended" true on the ones worth acting on (an empty list when there are none),',
    `and POST /api/replies {"replyTo":"${message.id}","state":"answered","text":"which findings to act on and why"}.`,
  ];
  return lines.join("\n");
}

// Findings still open whose code changed in a rebuild go back to the session to be looked at again.
export function recheckFrame(findings: Message[], scope: string) {
  const intro =
    `[review page] re-check ${findings.length} review ${findings.length === 1 ? "finding" : "findings"} on ${flat(scope)}: ` +
    "the code they are about changed in a rebuild. For each, " +
    'POST /api/replies {"replyTo":"<id>","state":"done","text":"how it was fixed"} when it no longer holds, ' +
    'or {"replyTo":"<id>","text":"why it still holds"} when it does.';
  const items = findings.map(finding => clip(`${finding.id} ${about(finding)}\n${indent(finding.text)}`, NOTE_LIMIT));
  return clip([intro, ...items].join("\n\n"), FRAME_LIMIT * 2);
}
