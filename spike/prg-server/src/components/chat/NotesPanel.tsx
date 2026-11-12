import { ChevronRight, ClipboardCopy, ExternalLink, NotebookPen, Send } from "lucide-react";
import { useRef, useState } from "react";
import type { GithubThread } from "shared/comments";
import type { Message } from "shared/messages";

import { useChatStore } from "src/components/chat/chat.store";
import { copyText, jumpTo, onCode, oneLine, pageOrder, shortLabel } from "src/components/chat/notes";
import { PostDialog } from "src/components/chat/PostDialog";
import { ClaudeThreadBlock, DraftEditor, StateBadge } from "src/components/chat/ThreadBlock";
import { type ClaudeThread, useThreads } from "src/components/chat/useThreads";
import { Badge } from "src/components/ui/badge";
import { Button } from "src/components/ui/button";
import { Summary } from "src/components/ui/disclosure";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "src/components/ui/empty";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceLine,
  TraceTitle,
} from "src/components/ui/trace";
import { useComments } from "src/queries/comments.query";
import { errorText, useDeleteDraft, useSendDrafts } from "src/queries/messages.mutation";
import { useSession } from "src/queries/messages.query";
import { useLayer, useReview } from "src/queries/review.query";
import { useViewStore } from "src/store/view.store";
import { cn } from "src/utils/cn";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

// A note's location, which jumps there unless a rebuild took it away.
function Where({ note }: { note: Message }) {
  const review = useReview().data;
  const label = shortLabel(note.anchor);
  const face = onCode(note.anchor) ? "font-mono text-xs" : "text-[13px]";
  if (note.anchor.outdated || note.anchor.kind === "general") {
    return <span className={cn("min-w-0 text-muted-foreground [overflow-wrap:anywhere]", face)}>{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => jumpTo(note.anchor, review)}
      className={cn("min-w-0 cursor-pointer text-left text-primary hover:underline [overflow-wrap:anywhere]", face)}
    >
      {label}
    </button>
  );
}

const Gone = () => <Badge tone="danger">No longer in the diff</Badge>;

function DraftItem({ note, pick }: { note: Message; pick: boolean }) {
  const [editing, setEditing] = useState(false);
  const remove = useDeleteDraft();
  const copied = useChatStore(state => state.copied[note.id] === note.text);
  const picked = useChatStore(state => state.picked.includes(note.id));
  const togglePicked = useChatStore(state => state.togglePicked);
  return (
    <li className="grid min-w-0 gap-1 rounded-md border bg-background px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {pick && (
          <input
            type="checkbox"
            checked={picked}
            onChange={() => togglePicked(note.id)}
            aria-label={`Pick ${shortLabel(note.anchor)} to post to GitHub`}
            className="size-3.5 accent-primary"
          />
        )}
        <Where note={note} />
        {note.anchor.outdated && <Gone />}
        {copied && (
          <Badge tone="outline" className="motion-swap">
            Copied
          </Badge>
        )}
        {note.posted && <Badge tone="outline">{note.posted.pending ? "On GitHub, pending" : "On GitHub"}</Badge>}
        {!editing && (
          <span className="ml-auto flex gap-3 text-xs">
            <button type="button" onClick={() => setEditing(true)} className="cursor-pointer text-muted-foreground hover:text-foreground">
              Edit
            </button>
            <button type="button" onClick={() => remove.mutate(note.id)} className="cursor-pointer text-muted-foreground hover:text-danger">
              Delete
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <DraftEditor message={note} onDone={() => setEditing(false)} />
      ) : (
        <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{note.text}</p>
      )}
    </li>
  );
}

// A sent note, folded to one line once it is settled; opening it shows the thread and its follow-up box.
function SentItem({ thread, pick }: { thread: ClaudeThread; pick: boolean }) {
  const { root, replies } = thread;
  const [open, setOpen] = useState(false);
  const picked = useChatStore(state => state.picked.includes(root.id));
  const togglePicked = useChatStore(state => state.togglePicked);
  const answer = replies.findLast(m => m.from === "claude");
  return (
    <li className={cn("min-w-0 rounded-md border bg-background", root.resolved && !open && "bg-muted/40")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? "Hide the thread" : "Show the thread"}
          className="cursor-pointer text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        {pick && (
          <input
            type="checkbox"
            checked={picked}
            onChange={() => togglePicked(root.id)}
            aria-label={`Pick ${shortLabel(root.anchor)} to post to GitHub`}
            className="size-3.5 accent-primary"
          />
        )}
        <Where note={root} />
        {root.anchor.outdated && <Gone />}
        <StateBadge state={root.state} />
        {root.status === "sent" && <Badge tone="outline">Waiting for a session</Badge>}
        {root.posted && <Badge tone="outline">{root.posted.pending ? "On GitHub, pending" : "On GitHub"}</Badge>}
        {!open && (
          <p className="min-w-0 basis-full truncate text-muted-foreground text-sm">
            {answer ? `Claude: ${oneLine(answer.text)}` : oneLine(root.text)}
          </p>
        )}
      </div>
      {open && (
        <div className="motion-grow">
          <ClaudeThreadBlock thread={thread} className="border-t" expanded />
        </div>
      )}
    </li>
  );
}

// Part of a batch, as a queue shows it: what is left, or what is done, folded once nothing in it needs a look.
function Queue({ title, notes, pick, open }: { title: string; notes: ClaudeThread[]; pick: (m: Message) => boolean; open: boolean }) {
  if (notes.length === 0) {
    return null;
  }
  return (
    <TraceCollapsible defaultOpen={open}>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceTitle className="font-medium">{title}</TraceTitle>
          <TraceDescription>{notes.length}</TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="pl-3">
        <ul className="grid grid-cols-1 gap-1.5">
          {notes.map(thread => (
            <SentItem key={thread.root.id} thread={thread} pick={pick(thread.root)} />
          ))}
        </ul>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function Batch({ batch, notes, pick }: { batch: number; notes: ClaudeThread[]; pick: (m: Message) => boolean }) {
  const sent = notes[0]?.root.sentAt;
  const all = notes.every(n => n.root.resolved);
  return (
    <details open={!all} className="group/batch motion-expand min-w-0">
      <Summary className="flex-wrap gap-x-3 gap-y-1">
        <span className="font-medium text-sm">{batch ? `Batch ${batch}` : "Sent"}</span>
        <span className="text-muted-foreground text-xs">
          {plural(notes.length, "note")}
          {sent && `, sent ${time.format(new Date(sent))}`}
          {all && ", all settled"}
        </span>
      </Summary>
      <Trace className="mt-2 pl-5">
        <Queue title="Left" notes={notes.filter(n => !n.root.resolved)} pick={pick} open />
        <Queue title="Done" notes={notes.filter(n => n.root.resolved)} pick={pick} open={false} />
      </Trace>
    </details>
  );
}

// Review threads on GitHub that have no line on this page: outdated, on a whole file, or on lines the diff leaves out.
function GithubElsewhere({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const { data } = useComments(layer, Boolean(shown?.capabilities.github));
  const threads = (data?.threads ?? []).filter(t => !t.place);
  if (!data || (data.threads.length === 0 && !data.error)) {
    return null;
  }
  const open = data.threads.filter(t => !t.resolved).length;
  const why = (t: GithubThread) => (t.outdated ? "outdated" : t.onFile ? "on the file" : "not on a line shown here");
  return (
    <div className="grid grid-cols-1 gap-2">
      <h3 className="font-medium text-sm">
        On GitHub{" "}
        {!data.error && (
          <span className="font-normal text-muted-foreground text-xs">{`${plural(data.threads.length, "review thread")}, ${open} open`}</span>
        )}
      </h3>
      {data.error && <p className="text-muted-foreground text-sm">Couldn't read them: {data.error}</p>}
      {data.headMoved && (
        <p className="text-muted-foreground text-sm">
          The pull request has moved since the guide was built, so some may sit on the wrong line.
        </p>
      )}
      {threads.length > 0 && (
        <ul className="grid grid-cols-1 gap-1.5">
          {threads.map(t => {
            const first = t.comments[0];
            return (
              <li key={t.id} className="grid gap-0.5 rounded-md border border-l-2 border-l-foreground/30 bg-muted/40 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className="font-mono [overflow-wrap:anywhere]">
                    {t.path}
                    {t.line ? `:${t.line}` : ""}
                  </span>
                  <Badge tone="outline">{why(t)}</Badge>
                  {t.resolved && <Badge tone="success">Resolved</Badge>}
                  {first?.url && (
                    <a
                      href={first.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Open on GitHub <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                {first && (
                  <p className="min-w-0 truncate text-sm">
                    <span className="font-medium">{first.author ?? "someone"}:</span> {first.body}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// The user's notes: drafts to read and change before they go anywhere, then each sent batch with how far Claude
// has got, and GitHub's own threads that have no line here. Copy notes is the way out with no session listening.
export function NotesPanel({ embedded = false }: { embedded?: boolean }) {
  const { notes } = useThreads();
  const review = useReview().data;
  const layer = useViewStore(state => state.layer);
  const shown = useLayer(layer);
  const { data: session } = useSession();
  const { data: comments } = useComments(layer ?? 0, Boolean(shown?.capabilities.github));
  const send = useSendDrafts();
  const remove = useDeleteDraft();
  const copied = useChatStore(state => state.copied);
  const markCopied = useChatStore(state => state.markCopied);
  const clearCopied = useChatStore(state => state.clearCopied);
  const picked = useChatStore(state => state.picked);
  const [status, setStatus] = useState("");
  const [manual, setManual] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  const order = pageOrder(review);
  const drafts = notes
    .map(n => n.root)
    .filter(m => m.status === "draft")
    .sort(order);
  const sent = notes.filter(n => n.root.status !== "draft").sort((a, b) => order(a.root, b.root));
  const batches = [...new Set(sent.map(n => n.root.batch ?? 0))].sort((a, b) => b - a);
  const nCopied = drafts.filter(d => copied[d.id] === d.text).length;
  const canPost = Boolean(comments?.canPost) && layer !== null;
  const postable = (m: Message) =>
    canPost && !m.posted && !m.anchor.outdated && (m.anchor.kind === "line" || m.anchor.kind === "tell") && m.anchor.layer === layer;
  const pickedNow = picked.filter(id => notes.some(n => n.root.id === id && postable(n.root)));
  const listening = Boolean(session?.listening);

  const sendAll = () =>
    send.mutate(undefined, {
      onSuccess: ({ sent: n, listening: now }) =>
        setStatus(
          now
            ? `Sent ${plural(n, "note")}. Claude reports back on each one here and in the session.`
            : `${plural(n, "note")} will go as soon as a session listens.`,
        ),
      onError: error => setStatus(errorText(error, "Not sent. Your notes are kept; try again.")),
    });

  // Called from the click, which the clipboard needs; where the browser refuses, the text is shown selected.
  const copy = () => {
    if (!review) {
      return;
    }
    const text = copyText(review, drafts);
    const done = () => {
      markCopied(drafts.map(d => ({ id: d.id, text: d.text })));
      setManual(null);
      setStatus(`Copied ${plural(drafts.length, "note")}. Paste them into your Claude session, then clear them here.`);
    };
    const fallback = () => {
      markCopied(drafts.map(d => ({ id: d.id, text: d.text })));
      setManual(text);
      setStatus("The browser blocked the clipboard: the notes are selected below, so press Cmd+C.");
      requestAnimationFrame(() => box.current?.select());
    };
    navigator.clipboard?.writeText(text).then(done, fallback) ?? fallback();
  };

  const clear = () => {
    for (const draft of drafts) {
      if (copied[draft.id] === draft.text) {
        remove.mutate(draft.id);
      }
    }
    clearCopied();
    setManual(null);
    setStatus("Cleared the copied notes.");
  };

  return (
    <section
      className={cn("grid min-w-0 grid-cols-1 gap-3", !embedded && "rounded-lg border border-l-4 border-l-warning bg-card p-4 shadow-xs")}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-serif text-lg">Your notes{drafts.length + sent.length ? ` (${drafts.length + sent.length})` : ""}</h2>
        <span className="text-muted-foreground text-sm">
          {drafts.length ? `${plural(drafts.length, "draft")}, kept until you send them` : "No drafts"}
        </span>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {canPost && (
            <Button size="sm" variant="outline" onClick={() => setPosting(true)} disabled={pickedNow.length === 0}>
              Post {pickedNow.length || ""} to GitHub…
            </Button>
          )}
          <Button
            size="sm"
            variant={listening ? "outline" : "default"}
            onClick={copy}
            disabled={drafts.length === 0}
            title="Copy the drafts to paste into your Claude session"
          >
            <ClipboardCopy />
            Copy notes
          </Button>
          {nCopied > 0 && (
            <Button size="sm" variant="ghost" onClick={clear}>
              Clear {nCopied} copied
            </Button>
          )}
          <Button size="sm" variant={listening ? "default" : "outline"} onClick={sendAll} disabled={drafts.length === 0 || send.isPending}>
            <Send />
            {drafts.length ? `Send ${plural(drafts.length, "note")} to Claude` : "No notes to send"}
          </Button>
        </div>
      </div>
      {!listening && drafts.length > 0 && (
        <p className="text-muted-foreground text-sm">
          No Claude session is listening. Sent notes wait here until one connects, or copy them into the session.
        </p>
      )}
      <p role="status" className="text-sm empty:hidden">
        {status && (
          <span key={status} className="motion-fade inline-block">
            {status}
          </span>
        )}
      </p>
      {manual !== null && (
        <textarea
          ref={box}
          readOnly
          rows={6}
          value={manual}
          aria-label="The notes, to copy"
          className="w-full rounded-md border bg-background p-2 font-mono text-xs"
        />
      )}
      {drafts.length === 0 && sent.length === 0 && (
        <Empty className="p-4">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <NotebookPen />
            </EmptyMedia>
            <EmptyTitle>No notes yet</EmptyTitle>
            <EmptyDescription>
              Notes you leave on lines, sections or anything with an Ask Claude button collect here until you send them.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {drafts.length > 0 && (
        <ul className="grid grid-cols-1 gap-1.5">
          {drafts.map(note => (
            <DraftItem key={note.id} note={note} pick={postable(note)} />
          ))}
        </ul>
      )}
      {batches.map(batch => (
        <Batch key={batch} batch={batch} notes={sent.filter(n => (n.root.batch ?? 0) === batch)} pick={postable} />
      ))}
      {layer !== null && shown?.capabilities.github && <GithubElsewhere layer={layer} />}
      {posting && layer !== null && <PostDialog layer={layer} ids={pickedNow} onClose={() => setPosting(false)} />}
    </section>
  );
}
