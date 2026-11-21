import { useMemo } from "react";
import type { GithubThread } from "shared/comments";
import type { Anchor, Message } from "shared/messages";
import { turnOf } from "shared/turn";

import { yours } from "src/components/chat/Turn";
import { useComments } from "src/queries/comments.query";
import { useMe } from "src/queries/me.query";
import { useMessages } from "src/queries/messages.query";
import { useLayer } from "src/queries/review.query";
import { anchorKey, lineKey } from "src/utils/anchors";

// A conversation with Claude, or a review thread already on the pull request. Both have root.id for a key.
export type ClaudeThread = { kind: "claude"; root: Message; replies: Message[] };
export type GithubThreadView = { kind: "github"; root: { id: string }; layer: number; thread: GithubThread };
export type Thread = ClaudeThread | GithubThreadView;

const NONE: Message[] = [];
const number = (message: Message) => Number(message.id.slice(1));

// Whether a message came after anything the reader has had on screen in its thread.
export const unread = (root: Message, message: Message) => number(message) > Number(root.seen?.slice(1) ?? 0);

// Claude's last answer in a thread, when it came after anything the user has had on screen there.
export function unseenReply({ root, replies }: ClaudeThread): Message | undefined {
  const answer = replies.findLast(m => m.from === "claude");
  return answer && unread(root, answer) ? answer : undefined;
}

// The messages in a thread that mention me, written by someone else.
export const mentionsOf = ({ root, replies }: ClaudeThread, me: number | undefined) =>
  me === undefined ? NONE : [root, ...replies].filter(m => m.mentions?.includes(me) && m.author?.id !== me);

function useThreadList() {
  const { data: messages = NONE } = useMessages();
  return useMemo(() => {
    const replies = new Map<string, Message[]>();
    for (const message of messages) {
      if (message.replyTo) {
        replies.set(message.replyTo, [...(replies.get(message.replyTo) ?? []), message]);
      }
    }
    // A quiz's questions are threads only in how they are kept: the ready check shows them, and nothing else does.
    const all: ClaudeThread[] = messages
      .filter(m => !m.replyTo && !m.quiz?.options)
      .map(root => ({ kind: "claude", root, replies: replies.get(root.id) ?? [] }));
    // An archived thread shows nowhere but the drawer's Archived list.
    return { messages, threads: all.filter(t => !t.root.archived), archived: all.filter(t => t.root.archived) };
  }, [messages]);
}

// The line a thread shows under, as lineKey writes it: a flagged line's thread sits under the flagged line.
function threadLine(thread: ClaudeThread, tells: { file: string; hunk: string; line: string }[]) {
  const { anchor } = thread.root;
  if (anchor.outdated) {
    return null;
  }
  if (anchor.kind === "line") {
    return { layer: anchor.layer, file: anchor.file, key: lineKey(anchor) };
  }
  if (anchor.kind === "tell") {
    const tell = tells.find(t => t.file === anchor.file && t.line === anchor.line);
    const side = anchor.line[0] === "L" ? "L" : "R";
    return tell
      ? { layer: anchor.layer, file: anchor.file, key: lineKey({ hunk: tell.hunk, side, line: Number(anchor.line.slice(1)) }) }
      : null;
  }
  return null;
}

// Threads on lines of one file, by lineKey, Claude's first and then GitHub's; a range's thread sits under its last line.
export function useAnchoredThreads(layer: number, fileId: string): Map<string, Thread[]> {
  const { threads } = useThreadList();
  const shown = useLayer(layer);
  const { data: comments } = useComments(layer, Boolean(shown?.capabilities.github));
  return useMemo(() => {
    const byLine = new Map<string, Thread[]>();
    const add = (key: string, thread: Thread) => byLine.set(key, [...(byLine.get(key) ?? []), thread]);
    for (const thread of threads) {
      const at = threadLine(thread, shown?.tells ?? []);
      if (at && at.layer === layer && at.file === fileId) {
        add(at.key, thread);
      }
    }
    for (const thread of comments?.threads ?? []) {
      if (thread.place?.file === fileId) {
        add(lineKey(thread.place), { kind: "github", root: { id: `gh-${thread.id}` }, layer, thread });
      }
    }
    return byLine;
  }, [threads, comments, shown, layer, fileId]);
}

// Every thread about one thing, for the Ask Claude button that starts them.
export function useThreadsAbout(anchor: Anchor) {
  const { threads } = useThreadList();
  const key = anchorKey(anchor);
  return useMemo(() => threads.filter(thread => anchorKey(thread.root.anchor) === key), [threads, key]);
}

export function useThreads() {
  const { messages, threads, archived } = useThreadList();
  const me = useMe();
  return useMemo(
    () => ({
      threads,
      archived,
      // Waiting on the reader: a question of Claude's that they may answer.
      yours: threads.filter(thread => yours(turnOf(thread.root, thread.replies), me)),
      // Not under a line: about something else, or about a line a rebuild took away.
      unplaced: threads.filter(thread => thread.root.anchor.outdated || !["line", "tell"].includes(thread.root.anchor.kind)),
      notes: threads.filter(thread => thread.root.kind === "note"),
      posts: threads.filter(thread => thread.root.kind === "post"),
      drafts: messages.filter(m => m.status === "draft").length,
      // Claude's newest answer the user hasn't had on screen, in a thread they haven't put away.
      latestReply: threads
        .flatMap(thread => unseenReply(thread) ?? [])
        .sort((a, b) => number(a) - number(b))
        .at(-1),
    }),
    [messages, threads, archived, me],
  );
}
