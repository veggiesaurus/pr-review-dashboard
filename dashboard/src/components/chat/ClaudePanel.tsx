import { Archive, ArchiveRestore, ArrowLeft, Crosshair, MessageCircle, Plus, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Anchor, PermissionsInfo } from "shared/messages";
import { Composer } from "src/components/chat/Composer";
import { type Focus, useChatStore } from "src/components/chat/chat.store";
import { NotesPanel } from "src/components/chat/NotesPanel";
import { describe, firstLine, GROUPS, jumpTo, onCode, oneLine, shortLabel } from "src/components/chat/notes";
import { ClaudeThreadBlock, ReplyBox, StateBadge, Thinking } from "src/components/chat/ThreadBlock";
import { type ClaudeThread, useThreads } from "src/components/chat/useThreads";
import { awaited, verbFor } from "src/components/chat/verbs";
import { Button } from "src/components/ui/button";
import { Summary } from "src/components/ui/disclosure";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "src/components/ui/empty";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "src/components/ui/message-scroller";
import { Segmented } from "src/components/ui/segmented";
import { useIsOwner } from "src/queries/me.query";
import { errorText, useArchiveReview, useArchiveThread, useSendDrafts } from "src/queries/messages.mutation";
import { useSession } from "src/queries/messages.query";
import { useAnswerPermission, usePermissions } from "src/queries/permissions.query";
import { useReview } from "src/queries/review.query";
import { useViewStore } from "src/store/view.store";
import { anchorKey } from "src/utils/anchors";
import { cn } from "src/utils/cn";
import { arrived } from "src/utils/motion";

function ThreadItem({ thread, active }: { thread: ClaudeThread; active: boolean }) {
  const openThread = useChatStore(state => state.openThread);
  const { root, replies } = thread;
  return (
    <li>
      <button
        type="button"
        onClick={() => openThread(root.id)}
        aria-current={active || undefined}
        className={cn(
          "grid w-full cursor-pointer gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted",
          active && "bg-muted text-foreground",
          root.resolved && !active && "opacity-70",
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("min-w-0 truncate", onCode(root.anchor) ? "font-mono text-xs" : "text-sm")}>{shortLabel(root.anchor)}</span>
          {root.anchor.outdated && <span className="shrink-0 text-danger text-xs">gone</span>}
          <span className="ml-auto shrink-0">
            <StateBadge state={root.state} />
          </span>
        </span>
        <span className="truncate text-muted-foreground text-xs">
          {root.kind === "note" ? "Note: " : root.kind === "post" ? "Post: " : ""}
          {oneLine(root.text)}
          {replies.length ? ` (${replies.length})` : ""}
        </span>
      </button>
    </li>
  );
}

function ThreadList({
  threads,
  archived,
  yours,
  focus,
}: {
  threads: ClaudeThread[];
  archived: ClaudeThread[];
  yours: ClaudeThread[];
  focus: Focus;
}) {
  const setFocus = useChatStore(state => state.setFocus);
  const active = focus?.kind === "thread" ? focus.id : null;
  const archiveReview = useArchiveReview();
  const owner = useIsOwner();
  // A review's request and findings are listed together, newest review first.
  const reviews = [...new Set(threads.flatMap(t => t.root.review?.n ?? []))].sort((a, b) => b - a);
  return (
    <nav aria-label="Threads with Claude" className="grid content-start gap-3">
      <Button
        size="sm"
        variant="outline"
        className="justify-start"
        onClick={() => setFocus({ kind: "anchor", anchor: { kind: "general" } })}
      >
        <Plus />
        Ask Claude about the review as a whole
      </Button>
      {threads.length === 0 && (
        <Empty className="p-4">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageCircle />
            </EmptyMedia>
            <EmptyTitle>No threads yet</EmptyTitle>
            <EmptyDescription>Click a line's number, or Ask Claude on a section, flag, claim or check.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {yours.length > 0 && (
        <div>
          <h3 className="px-2 font-medium text-primary text-xs">Waiting on you ({yours.length})</h3>
          <ul className="mt-1 grid gap-0.5">
            {yours.map(thread => (
              <ThreadItem key={thread.root.id} thread={thread} active={active === thread.root.id} />
            ))}
          </ul>
        </div>
      )}
      {reviews.map(n => {
        const mine = threads.filter(t => t.root.review?.n === n);
        return (
          <div key={`review-${n}`}>
            <h3 className="flex items-center px-2 font-medium text-muted-foreground text-xs">
              Review {n} ({mine.length})
              {owner && (
                <button
                  type="button"
                  className="ml-auto cursor-pointer hover:text-foreground"
                  title={`Archive every thread of review ${n}`}
                  aria-label={`Archive every thread of review ${n}`}
                  disabled={archiveReview.isPending}
                  onClick={() => archiveReview.mutate(n)}
                >
                  <Archive className="size-3.5" />
                </button>
              )}
            </h3>
            <ul className="mt-1 grid gap-0.5">
              {mine.map(thread => (
                <ThreadItem key={thread.root.id} thread={thread} active={active === thread.root.id} />
              ))}
            </ul>
          </div>
        );
      })}
      {GROUPS.map(group => {
        const mine = threads.filter(t => !t.root.review && group.kinds.includes(t.root.anchor.kind));
        return mine.length === 0 ? null : (
          <div key={group.name}>
            <h3 className="px-2 font-medium text-muted-foreground text-xs">
              {group.name} ({mine.length})
            </h3>
            <ul className="mt-1 grid gap-0.5">
              {mine.map(thread => (
                <ThreadItem key={thread.root.id} thread={thread} active={active === thread.root.id} />
              ))}
            </ul>
          </div>
        );
      })}
      {archived.length > 0 && (
        <details open={archived.some(t => t.root.id === active) || undefined}>
          <Summary className="px-2 font-medium text-muted-foreground text-xs">Archived ({archived.length})</Summary>
          <ul className="mt-1 grid gap-0.5">
            {archived.map(thread => (
              <ThreadItem key={thread.root.id} thread={thread} active={active === thread.root.id} />
            ))}
          </ul>
        </details>
      )}
    </nav>
  );
}

function About({ text, anchor, outdated, code }: { text: string; anchor: Anchor | null; outdated?: boolean; code: boolean }) {
  const review = useReview().data;
  const setChatOpen = useChatStore(state => state.setChatOpen);
  const canJump = anchor !== null && anchor.kind !== "general" && !outdated;
  return (
    <div className="flex flex-wrap items-start gap-2">
      <p className="min-w-0 flex-1 text-sm">
        <span className="text-muted-foreground">About </span>
        <span className={cn("[overflow-wrap:anywhere]", code && "font-mono text-sm")}>{text}</span>
        {outdated && <span className="text-danger"> (no longer in the diff since a rebuild)</span>}
      </p>
      {canJump && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onClick={() => {
            if (jumpTo(anchor, review)) {
              setChatOpen(false);
            }
          }}
        >
          <Crosshair />
          Show it
        </Button>
      )}
    </div>
  );
}

// The right-hand side of the drawer: one thread, or what has been said about one thing with a box to say more.
function Pane({ threads, archived, focus }: { threads: ClaudeThread[]; archived: ClaudeThread[]; focus: Focus }) {
  const review = useReview().data;
  const layer = useViewStore(state => state.layer);
  const composer = useChatStore(state => state.composer);
  if (focus?.kind === "thread") {
    const thread = [...threads, ...archived].find(t => t.root.id === focus.id);
    if (!thread) {
      return <p className="text-muted-foreground text-sm">That thread has gone.</p>;
    }
    return (
      <div className="grid gap-2">
        <About
          text={thread.root.anchor.loc ?? thread.root.anchor.label ?? "the review as a whole"}
          anchor={thread.root.anchor}
          outdated={thread.root.anchor.outdated}
          code={onCode(thread.root.anchor)}
        />
        {thread.root.anchor.detail && (
          <pre className="max-h-40 overflow-auto rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-xs">{thread.root.anchor.detail}</pre>
        )}
        <ClaudeThreadBlock key={thread.root.id} thread={thread} className="border" expanded />
      </div>
    );
  }
  const anchor: Anchor = focus?.anchor ?? { kind: "general", ...(layer === null ? {} : { layer }) };
  const key = anchorKey(anchor);
  const about = threads.filter(t => anchorKey(t.root.anchor) === key || (anchor.kind === "general" && t.root.anchor.kind === "general"));
  const composing = composer !== null && anchorKey(composer) === key;
  return (
    <div className="grid gap-2">
      <About text={describe(anchor, review)} anchor={anchor} code={["line", "tell", "hunk", "file"].includes(anchor.kind)} />
      {about.map(thread => (
        <ClaudeThreadBlock key={thread.root.id} thread={thread} className="border" />
      ))}
      {composing || anchor.kind !== "general" ? (
        // Keyed by what it is about, so text typed about one thing never follows the drawer to another.
        <Composer key={key} anchor={anchor} bare />
      ) : (
        <ReplyBox key={key} anchor={anchor} placeholder="Ask Claude about this review" />
      )}
    </div>
  );
}

// The oldest permission prompt the session is stopped at, which the owner may answer here instead of in the terminal.
function PermissionBar({ info }: { info: PermissionsInfo }) {
  const answer = useAnswerPermission();
  const [expanded, setExpanded] = useState(false);
  // The buttons wait a moment after a prompt appears, so a double tap on the last one can't approve this.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 700);
    return () => clearTimeout(timer);
  }, []);
  const [prompt, ...rest] = info.prompts;
  if (!prompt) {
    return null;
  }
  const choose = (behavior: "allow" | "deny") => answer.mutate({ id: prompt.id, behavior });
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-live="polite">
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-warning" />
      <span className="font-medium">{prompt.text}</span>
      {prompt.code && (
        <button
          type="button"
          className={cn("max-w-[28rem] text-left", expanded && "max-w-full")}
          aria-expanded={expanded}
          title={expanded ? "Show less" : "Show all"}
          onClick={() => setExpanded(!expanded)}
        >
          <code
            className={cn(
              "block rounded bg-muted px-1.5 py-0.5 font-mono text-xs",
              expanded ? "whitespace-pre-wrap break-all" : "truncate",
            )}
          >
            {prompt.code}
          </code>
        </button>
      )}
      {prompt.description && <span className="truncate text-muted-foreground">{prompt.description}</span>}
      {rest.length > 0 && <span className="text-muted-foreground">and {rest.length} more</span>}
      {info.answerable ? (
        <>
          <Button
            size="sm"
            disabled={!ready || answer.isPending}
            aria-label={`Allow: ${prompt.text}${prompt.code ? ` ${prompt.code}` : ""}`}
            onClick={() => choose("allow")}
          >
            Allow
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!ready || answer.isPending}
            aria-label={`Deny: ${prompt.text}${prompt.code ? ` ${prompt.code}` : ""}`}
            onClick={() => choose("deny")}
          >
            Deny
          </Button>
        </>
      ) : (
        <span className="text-muted-foreground">Answer on this computer or in the terminal.</span>
      )}
      {answer.isError && <span className="text-danger">{errorText(answer.error)}</span>}
    </span>
  );
}

// What the session is up to, as the panel's header and the top bar's button both say it.
function useClaudeStatus(connected: boolean) {
  const { threads } = useThreads();
  const { data: session } = useSession();
  const owner = useIsOwner();
  const permissions = usePermissions();
  const listening = connected && Boolean(session?.listening);
  // What the session last said it is doing, while it's listening.
  const activity = listening ? (session?.activity ?? null) : null;
  // With nothing said, a thread that waits on an answer still shows Claude at work.
  const waiting = threads.flatMap(t => awaited(t.root, t.replies) ?? []).at(-1);
  const busy = listening && (activity !== null || waiting !== undefined);
  // The prompt is in the owner's terminal, so only the owner can act on it.
  const prompting = connected && owner && (permissions?.prompts.length ?? 0) > 0;
  const attention = connected && owner && !prompting ? (session?.attention ?? null) : null;
  const text = !connected
    ? "Lost the server"
    : attention
      ? `Waiting for you in the terminal: ${attention.text}`
      : activity
        ? activity.text
        : busy
          ? `${verbFor(waiting?.id ?? "")}…`
          : listening
            ? "Listening"
            : "Not listening. Messages are kept for later.";
  const dot = attention || prompting ? "animate-pulse bg-warning" : listening ? "bg-success" : connected ? "bg-warning" : "bg-danger";
  return { text, dot, busy, attention, prompting, permissions, listening };
}

const PRESSED_BAR = "bg-secondary text-foreground hover:bg-secondary";

// The top bar's way into the panel: how many threads are open, whether any wait on you, and whether Claude is there.
export function ClaudeButton() {
  const { threads, yours } = useThreads();
  const connected = useChatStore(state => state.connected);
  const { text, dot } = useClaudeStatus(connected);
  const { chatOpen, setChatOpen, openDrawer } = useChatStore();
  const open = threads.filter(t => t.root.status !== "draft" && !t.root.resolved).length;
  return (
    <Button
      size="sm"
      variant="outline"
      className={cn("shrink-0", chatOpen && PRESSED_BAR)}
      onClick={() => (chatOpen ? setChatOpen(false) : openDrawer("chat"))}
      aria-pressed={chatOpen}
      title={text}
    >
      <span aria-hidden className={cn("motion-status size-2 rounded-full", dot)} />
      Claude{open ? ` (${open})` : ""}
      {yours.length > 0 && (
        <span title={`${yours.length} waiting on you`} className="size-2 rounded-full bg-primary">
          <span className="sr-only">, {yours.length} waiting on you</span>
        </span>
      )}
    </Button>
  );
}

// Everything said with Claude and every draft note, beside the code rather than over it. page is a phone's whole
// screen for it; otherwise it docks on the right of a wide window and slides over the page on a narrower one.
export function ClaudePanel({ page = false }: { page?: boolean }) {
  const { threads, archived, yours, drafts, latestReply } = useThreads();
  const send = useSendDrafts();
  const archive = useArchiveThread();
  const owner = useIsOwner();
  const connected = useChatStore(state => state.connected);
  const { chatOpen, drawer, focus, composer, setChatOpen, openDrawer, setFocus, openThread } = useChatStore();
  const status = useClaudeStatus(connected);
  const { prompting, permissions, busy, attention } = status;

  // A permission prompt stops the session until someone answers it, so it opens the panel where the answer is.
  const prompt = prompting ? permissions?.prompts[0]?.id : undefined;
  useEffect(() => {
    if (prompt) {
      openDrawer("chat");
    }
  }, [prompt, openDrawer]);

  // Escape closes the panel, unless a dialog or menu over it is open and takes the key first. What was typed is kept.
  useEffect(() => {
    if (!chatOpen || page) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[role=dialog], [data-radix-popper-content-wrapper]")) {
        setChatOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatOpen, page, setChatOpen]);

  if (!chatOpen && !page) {
    return null;
  }

  // The thread the panel has open, which the icon beside Close puts away or brings back.
  const shown =
    drawer === "chat" && focus?.kind === "thread"
      ? [...threads, ...archived].find(t => t.root.id === focus.id && t.root.status !== "draft")?.root
      : undefined;
  const archiveLabel = shown?.archived ? "Unarchive this thread" : "Archive this thread";

  return (
    <aside
      aria-label="Claude"
      className={cn(
        "flex min-h-0 flex-col bg-card",
        page
          ? "min-h-[calc(100dvh-7rem)]"
          : "motion-drawer fixed top-12 right-0 bottom-0 z-40 w-[min(100vw,28rem)] border-l shadow-lg xl:sticky xl:z-auto xl:h-[calc(100dvh-3rem)] xl:w-auto xl:shadow-none",
      )}
    >
      <div className={cn("grid gap-2 border-b py-3", page ? "px-0" : "px-4")}>
        <div className="flex items-center gap-2">
          {drawer === "chat" && focus ? (
            <Button size="sm" variant="ghost" className="-ml-2 px-2" onClick={() => setFocus(null)}>
              <ArrowLeft />
              All threads
            </Button>
          ) : (
            <h2 className="font-serif text-xl">Claude</h2>
          )}
          <span className="ml-auto flex items-center gap-1">
            {owner && shown && (
              <Button
                variant="ghost"
                size="icon"
                disabled={archive.isPending}
                onClick={() =>
                  archive.mutate(
                    { id: shown.id, archived: !shown.archived },
                    // Putting a thread away goes back to the list; bringing one back stays on it.
                    { onSuccess: () => !shown.archived && setFocus(null) },
                  )
                }
                aria-label={archiveLabel}
                title={archiveLabel}
              >
                {shown.archived ? <ArchiveRestore /> : <Archive />}
              </Button>
            )}
            {!page && (
              <Button variant="ghost" size="icon" onClick={() => setChatOpen(false)} aria-label="Close">
                <X />
              </Button>
            )}
          </span>
        </div>
        {prompting && permissions ? (
          <PermissionBar key={permissions.prompts[0]?.id} info={permissions} />
        ) : (
          <p className="flex min-w-0 items-center gap-2 text-sm" aria-live="polite">
            {busy && !attention ? <Thinking /> : <span className={cn("motion-status size-2 shrink-0 rounded-full", status.dot)} />}
            <span className={cn("truncate", attention && "font-medium")} title={status.text}>
              {status.text}
            </span>
          </p>
        )}
        {latestReply && !focus && (
          <button
            key={latestReply.id}
            type="button"
            onClick={() => openThread(latestReply.replyTo ?? latestReply.id)}
            className={cn(
              "min-w-0 cursor-pointer truncate text-left text-primary text-sm hover:underline",
              arrived(latestReply.at) && "motion-swap",
            )}
          >
            Claude: {firstLine(latestReply.text)}
          </button>
        )}
        <Segmented
          label="Claude's lists"
          value={drawer}
          onChange={openDrawer}
          className="justify-self-start"
          segments={[
            { value: "chat", label: `Threads${threads.length ? ` (${threads.length})` : ""}` },
            { value: "notes", label: `Notes${drafts ? ` (${drafts})` : ""}` },
          ]}
        />
      </div>
      {/* On a phone the panel is the whole screen and scrolls with the page; a scroll box of its own there would hold
          the swipe without being able to scroll. */}
      <div className={cn("py-3", page ? "px-0" : "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4")}>
        {drawer === "notes" ? (
          <div className="motion-fade">
            <NotesPanel embedded />
          </div>
        ) : focus && page ? (
          <Pane threads={threads} archived={archived} focus={focus} />
        ) : focus ? (
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller className="h-auto min-w-0">
              <MessageScrollerViewport className="h-auto">
                <MessageScrollerContent className="min-h-0">
                  <MessageScrollerItem>
                    <Pane threads={threads} archived={archived} focus={focus} />
                  </MessageScrollerItem>
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton className="bottom-2" />
            </MessageScroller>
          </MessageScrollerProvider>
        ) : (
          <ThreadList threads={threads} archived={archived} yours={yours} focus={focus} />
        )}
      </div>
      {/* The Notes list has its own, beside Copy and Post. */}
      {drafts > 0 && drawer !== "notes" && composer === null && (
        <div className={cn("flex items-center justify-end gap-2 border-t py-3", page ? "px-0" : "px-4")}>
          <Button onClick={() => send.mutate()} disabled={send.isPending}>
            <Send />
            Send {drafts} {drafts === 1 ? "note" : "notes"}
          </Button>
        </div>
      )}
    </aside>
  );
}
