import { Archive, ArchiveRestore, ArrowLeft, Crosshair, MessageCircle, NotebookPen, Plus, Send, X } from "lucide-react";
import { useEffect } from "react";
import type { Anchor } from "shared/messages";
import { Composer } from "src/components/chat/Composer";
import { type Focus, useChatStore } from "src/components/chat/chat.store";
import { NotesPanel } from "src/components/chat/NotesPanel";
import { describe, GROUPS, jumpTo, onCode, oneLine, shortLabel } from "src/components/chat/notes";
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
import { useArchiveReview, useArchiveThread, useSendDrafts } from "src/queries/messages.mutation";
import { useSession } from "src/queries/messages.query";
import { useReview } from "src/queries/review.query";
import { PAGE_COLUMN, useViewStore } from "src/store/view.store";
import { anchorKey } from "src/utils/anchors";
import { cn } from "src/utils/cn";
import { arrived } from "src/utils/motion";

// Each part of the drawer that scrolls: capped to the window, and never sideways.
const DRAWER_SCROLL = "-mx-1 mt-1 max-h-[min(60dvh,36rem)] overflow-y-auto overflow-x-hidden overscroll-contain p-1";

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
          <span className={cn("min-w-0 truncate", onCode(root.anchor) ? "font-mono text-xs" : "text-[13px]")}>
            {shortLabel(root.anchor)}
          </span>
          {root.anchor.outdated && <span className="shrink-0 text-danger text-xs">gone</span>}
          <span className="ml-auto shrink-0">
            <StateBadge state={root.state} />
          </span>
        </span>
        <span className="truncate text-muted-foreground text-xs">
          {root.kind === "note" ? "Note: " : ""}
          {oneLine(root.text)}
          {replies.length ? ` (${replies.length})` : ""}
        </span>
      </button>
    </li>
  );
}

function ThreadList({ threads, archived, focus }: { threads: ClaudeThread[]; archived: ClaudeThread[]; focus: Focus }) {
  const setFocus = useChatStore(state => state.setFocus);
  const active = focus?.kind === "thread" ? focus.id : null;
  const archiveReview = useArchiveReview();
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
        Ask about the review as a whole
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
      {reviews.map(n => {
        const mine = threads.filter(t => t.root.review?.n === n);
        return (
          <div key={`review-${n}`}>
            <h3 className="flex items-center px-2 font-medium text-muted-foreground text-xs">
              Review {n} ({mine.length})
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
        <span className={cn("[overflow-wrap:anywhere]", code && "font-mono text-[13px]")}>{text}</span>
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

export function ChatDock({ connected }: { connected: boolean }) {
  const { threads, archived, drafts, latestReply } = useThreads();
  const { data: session } = useSession();
  const send = useSendDrafts();
  const archive = useArchiveThread();
  const { chatOpen, drawer, focus, setChatOpen, openDrawer, setFocus, openThread } = useChatStore();
  const listening = connected && Boolean(session?.listening);
  // What the session last said it is doing, while it's listening.
  const activity = listening ? (session?.activity ?? null) : null;
  // With nothing said, a thread that waits on an answer still shows Claude at work.
  const waiting = threads.flatMap(t => awaited(t.root, t.replies) ?? []).at(-1);
  const busy = listening && (activity !== null || waiting !== undefined);
  const attention = connected ? (session?.attention ?? null) : null;
  const status = !connected
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
  const open = threads.filter(t => t.root.status !== "draft" && !t.root.resolved).length;

  // Escape closes the drawer, unless a dialog or menu over it is open and takes the key first. What was typed is kept.
  useEffect(() => {
    if (!chatOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[role=dialog], [data-radix-popper-content-wrapper]")) {
        setChatOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatOpen, setChatOpen]);

  // The thread the drawer has open, which the icon beside Close puts away or brings back.
  const shown =
    drawer === "chat" && focus?.kind === "thread"
      ? [...threads, ...archived].find(t => t.root.id === focus.id && t.root.status !== "draft")?.root
      : undefined;
  const archiveLabel = shown?.archived ? "Unarchive this thread" : "Archive this thread";

  const toggle = (which: "chat" | "notes") => (chatOpen && drawer === which ? setChatOpen(false) : openDrawer(which));

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 shadow-lg backdrop-blur">
      <div className={PAGE_COLUMN}>
        {chatOpen && (
          <div className="motion-drawer">
            <div className="border-b py-3">
              <div className="flex items-center gap-2">
                {drawer === "chat" && <h2 className="font-serif text-lg">Chat with Claude</h2>}
                {drawer === "chat" && focus && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 md:hidden" onClick={() => setFocus(null)}>
                    <ArrowLeft />
                    All threads
                  </Button>
                )}
                <span className="ml-auto flex items-center gap-1">
                  {shown && (
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
                  <Button variant="ghost" size="icon" onClick={() => setChatOpen(false)} aria-label="Close">
                    <X />
                  </Button>
                </span>
              </div>
              {drawer === "notes" ? (
                <div className={cn("motion-fade", DRAWER_SCROLL)}>
                  <NotesPanel embedded />
                </div>
              ) : (
                // The list and the open thread scroll apart, so the thread can follow Claude's answers as they come.
                <div className="motion-fade mt-1 grid gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
                  <div className={cn(DRAWER_SCROLL, "mt-0", focus && "max-md:hidden")}>
                    <ThreadList threads={threads} archived={archived} focus={focus} />
                  </div>
                  <MessageScrollerProvider autoScroll defaultScrollPosition="end">
                    <MessageScroller className={cn("h-auto min-w-0", !focus && "max-md:hidden")}>
                      <MessageScrollerViewport className={cn(DRAWER_SCROLL, "mt-0 h-auto")}>
                        <MessageScrollerContent className="min-h-0">
                          <MessageScrollerItem>
                            <Pane threads={threads} archived={archived} focus={focus} />
                          </MessageScrollerItem>
                        </MessageScrollerContent>
                      </MessageScrollerViewport>
                      <MessageScrollerButton className="bottom-2" />
                    </MessageScroller>
                  </MessageScrollerProvider>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
          <span className="flex min-w-0 items-center gap-2 text-sm" aria-live="polite">
            {busy && !attention ? (
              <Thinking />
            ) : (
              <span
                className={cn(
                  "motion-status size-2 shrink-0 rounded-full",
                  attention ? "animate-pulse bg-warning" : listening ? "bg-success" : connected ? "bg-warning" : "bg-danger",
                )}
              />
            )}
            <span className={cn("truncate", attention && "font-medium")} title={status}>
              {status}
            </span>
          </span>
          {latestReply && (
            <button
              key={latestReply.id}
              type="button"
              onClick={() => openThread(latestReply.replyTo ?? latestReply.id)}
              className={cn(
                "min-w-0 max-w-md flex-1 cursor-pointer truncate text-left text-primary text-sm hover:underline",
                arrived(latestReply.at) && "motion-swap",
              )}
            >
              Claude: {oneLine(latestReply.text)}
            </button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={chatOpen && drawer === "chat" ? "default" : "outline"}
              onClick={() => toggle("chat")}
              aria-pressed={chatOpen && drawer === "chat"}
            >
              <MessageCircle />
              Chat{open ? ` (${open})` : ""}
            </Button>
            <Button
              size="sm"
              variant={chatOpen && drawer === "notes" ? "default" : "outline"}
              onClick={() => toggle("notes")}
              aria-pressed={chatOpen && drawer === "notes"}
            >
              <NotebookPen />
              Notes{drafts ? ` (${drafts})` : ""}
            </Button>
            {/* With nothing to send it is only a label, which a phone has no room for. */}
            <Button
              size="sm"
              onClick={() => send.mutate()}
              disabled={drafts === 0 || send.isPending}
              className={cn(drafts === 0 && "max-sm:hidden")}
            >
              <Send />
              {drafts === 0 ? "No notes to send" : `Send ${drafts} ${drafts === 1 ? "note" : "notes"}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
