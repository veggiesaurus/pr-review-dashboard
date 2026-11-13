import { ChevronDown, ChevronRight, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { type FormEvent, Fragment, useEffect, useRef, useState } from "react";
import type { GithubComment } from "shared/comments";
import type { Anchor, Message, NoteState } from "shared/messages";
import { DISMISS_REASONS, DISMISS_TEXT, fixable, standing } from "shared/reviews";

import { draftText, replyKey, saveDraftText } from "src/components/chat/chat.store";
import { IntentBadge } from "src/components/chat/Intent";
import { MarkdownEditor } from "src/components/chat/MarkdownEditor";
import { oneLine, STATE_TEXT, STATE_TONE } from "src/components/chat/notes";
import { Screenshots, useScreenshots } from "src/components/chat/Screenshots";
import { Ask, Note, Steps, timeline } from "src/components/chat/Timeline";
import { type ClaudeThread, type GithubThreadView, type Thread, unseenReply } from "src/components/chat/useThreads";
import { awaited, verbFor } from "src/components/chat/verbs";
import { Markdown, MessageText } from "src/components/links/Markdown";
import { Avatar, AvatarFallback, AvatarImage } from "src/components/ui/avatar";
import { Badge } from "src/components/ui/badge";
import { Button } from "src/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "src/components/ui/dropdown-menu";
import { errorText, useAddMessage, useArchiveThread, useDeleteDraft, useEditDraft, useMarkSeen } from "src/queries/messages.mutation";
import { useSession } from "src/queries/messages.query";
import { useViewStore } from "src/store/view.store";
import { anchorKey } from "src/utils/anchors";
import { cn } from "src/utils/cn";
import { ago, fullDate } from "src/utils/dates";
import { arrived } from "src/utils/motion";

const SEVERITY_TONE = { high: "danger", medium: "warning", low: "neutral" } as const;

// How bad Claude says a review finding is.
export function SeverityBadge({ message }: { message: Message }) {
  const severity = message.review?.severity;
  return severity ? <Badge tone={SEVERITY_TONE[severity]}>{severity} severity</Badge> : null;
}

export function StateBadge({ state }: { state: NoteState }) {
  const text = STATE_TEXT[state];
  return text ? <Badge tone={STATE_TONE[state]}>{text}</Badge> : null;
}

// What else is known of a review finding: an earlier review read the same code, the user dismissed it, or its code is gone.
export function FindingBadges({ message }: { message: Message }) {
  const { missed, dismissed } = message.review ?? {};
  return (
    <>
      {missed && <Badge tone="outline">Missed before</Badge>}
      {dismissed && <Badge>Dismissed: {DISMISS_TEXT[dismissed].toLowerCase()}</Badge>}
      {standing(message) === "outdated" && <Badge tone="outline">Outdated</Badge>}
    </>
  );
}

// The change Claude proposes for a finding, as the few lines of diff it sent.
function Patch({ text }: { text: string }) {
  return (
    <figure className="grid gap-1">
      <figcaption className="text-muted-foreground text-xs">Proposed patch</figcaption>
      <pre className="overflow-x-auto rounded-md border bg-muted/60 py-1.5 font-mono text-[12.5px] leading-normal">
        {text.split("\n").map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a patch's lines have no id and keep their order
          <span key={index} className={cn("block px-2.5", line.startsWith("+") ? "bg-diff-add" : line.startsWith("-") && "bg-diff-del")}>
            {line || " "}
          </span>
        ))}
      </pre>
    </figure>
  );
}

function Delivery({ message }: { message: Message }) {
  if (message.from === "claude") {
    return null;
  }
  if (message.status === "sent") {
    return <Badge tone="outline">Waiting for a session</Badge>;
  }
  return message.status === "delivered" && message.state === "open" ? <span className="text-muted-foreground">sent to Claude</span> : null;
}

// Three dots that rise in turn while Claude is at work.
export function Thinking() {
  return (
    <span className="motion-thinking inline-flex shrink-0 items-center gap-[3px]" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

// Under a thread Claude owes an answer on: what the session says it's doing for it, or one of Claude Code's verbs.
function Working({ thread, waiting }: { thread: string; waiting: Message | null }) {
  const { data: session } = useSession();
  const activity = session?.listening && session.activity?.thread === thread ? session.activity : null;
  if (!activity && !(waiting && session?.listening)) {
    return null;
  }
  return (
    <p className="motion-fade flex items-center gap-2 text-muted-foreground text-xs" aria-live="polite">
      <Thinking />
      {activity ? activity.text : `${verbFor(waiting?.id ?? "")}…`}
    </p>
  );
}

function Posted({ message }: { message: Message }) {
  if (!message.posted) {
    return null;
  }
  const text = message.posted.pending ? "On GitHub, pending" : "On GitHub";
  return message.posted.url ? (
    <a href={message.posted.url} target="_blank" rel="noreferrer" className="inline-flex">
      <Badge tone="outline">
        {text} <ExternalLink />
      </Badge>
    </a>
  ) : (
    <Badge tone="outline">{text}</Badge>
  );
}

// A draft's text in a box, saved with Save; Escape or Cancel leaves it as it was.
export function DraftEditor({ message, onDone }: { message: Message; onDone: () => void }) {
  const [text, setText] = useState(message.text);
  const edit = useEditDraft();
  const save = () => {
    if (text.trim() === message.text.trim()) {
      onDone();
    } else if (text.trim()) {
      edit.mutate({ id: message.id, text }, { onSuccess: onDone });
    }
  };
  return (
    <div className="grid gap-2">
      <MarkdownEditor
        autoFocus
        value={text}
        onChange={setText}
        onSend={save}
        onEscape={onDone}
        sendKey="mod-enter"
        label="Edit note"
        placeholder=""
        className="[&_.ProseMirror]:min-h-16"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={!text.trim() || edit.isPending}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {edit.isError && <span className="text-danger text-sm">{errorText(edit.error, "That didn't save.")}</span>}
      </div>
    </div>
  );
}

// The PR a message's links resolve in: its own, else the one on screen.
export const layerOf = (message: Message, shown: number | null) =>
  "layer" in message.anchor && message.anchor.layer !== undefined ? message.anchor.layer : (shown ?? 0);

// A note not sent yet, under its line as the skill's page shows one: the text, then Edit and Delete.
export function DraftNote({ message }: { message: Message }) {
  const shown = useViewStore(state => state.layer);
  const [editing, setEditing] = useState(false);
  const remove = useDeleteDraft();
  return (
    <div id={`t-${message.id}`} className="grid gap-1.5 border-l-2 border-l-warning bg-card px-3 py-2.5 font-sans">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="warning">Draft note</Badge>
        <IntentBadge message={message} />
        <Posted message={message} />
        <span className="text-muted-foreground">kept until you send your notes</span>
        {!editing && (
          <span className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(true)}>
              <Pencil />
              Edit
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 hover:text-danger" onClick={() => remove.mutate(message.id)}>
              <Trash2 />
              Delete
            </Button>
          </span>
        )}
      </div>
      {editing ? (
        <DraftEditor message={message} onDone={() => setEditing(false)} />
      ) : (
        <MessageText text={message.text} layer={layerOf(message, shown)} />
      )}
      <Screenshots ids={message.images} />
    </div>
  );
}

export function Bubble({ message }: { message: Message }) {
  const shown = useViewStore(state => state.layer);
  const layer = layerOf(message, shown);
  const mine = message.from === "user";
  return (
    <div className={cn("rounded-md border px-2.5 py-2", mine ? "bg-background" : "border-primary/25 bg-primary/6")}>
      <div className="flex flex-wrap items-center gap-x-2 text-xs">
        <span className={cn("font-medium", mine ? "text-foreground/75" : "text-primary")}>{mine ? "You" : "Claude"}</span>
        <time dateTime={message.at} title={fullDate(message.at)} className="text-muted-foreground">
          {ago(message.at)}
        </time>
        {mine && message.replyTo && <Delivery message={message} />}
      </div>
      <MessageText text={message.text} layer={layer} className="mt-1" />
      {message.images && (
        <div className="mt-1.5">
          <Screenshots ids={message.images} />
        </div>
      )}
    </div>
  );
}

// A follow-up takes its thread's anchor; a new message from the drawer takes anchor. What is typed is kept as a
// composer's is, so it outlives the thread folding or the drawer closing.
export function ReplyBox({ replyTo, anchor, placeholder }: { replyTo?: string; anchor?: Anchor; placeholder: string }) {
  const key = replyTo ? replyKey(replyTo) : anchor ? anchorKey(anchor) : "";
  const [text, setText] = useState(() => draftText(key));
  const add = useAddMessage();
  const shots = useScreenshots();

  const update = (value: string) => {
    setText(value);
    saveDraftText(key, value);
  };
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (text.trim() && !add.isPending && !shots.uploading) {
      add.mutate(
        { kind: "chat", text, replyTo, anchor, ...(shots.images.length && { images: shots.images }) },
        {
          onSuccess: () => {
            update("");
            shots.clear();
          },
        },
      );
    }
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-1" {...shots.handlers}>
      <Screenshots ids={shots.images} onRemove={shots.remove} />
      <div className="flex gap-2">
        <MarkdownEditor
          value={text}
          onChange={update}
          onSend={() => submit()}
          onFiles={shots.take}
          sendKey="enter"
          label={placeholder}
          placeholder={placeholder}
          className="flex-1"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!text.trim() || add.isPending || shots.uploading}>
          Send
        </Button>
      </div>
      {shots.error && <span className="text-danger text-sm">{shots.error}</span>}
      {add.isError && <span className="text-danger text-sm">{errorText(add.error, "That didn't send.")}</span>}
    </form>
  );
}

// A thread with Claude. A settled one folds to its last answer and opens again on a click.
export function ClaudeThreadBlock({ thread, className, expanded }: { thread: ClaudeThread; className?: string; expanded?: boolean }) {
  const { root, replies } = thread;
  // A finding of a review the user asked for, which Claude wrote first, and whether its code has left the diff.
  const finding = root.from === "claude" && root.review !== undefined;
  const gone = finding && standing(root) === "outdated";
  // A follow-up left half typed keeps its thread open, so it isn't out of sight when Claude settles the thread.
  const typing = () => draftText(replyKey(root.id)) !== "";
  const [open, setOpen] = useState(() => expanded ?? (!(root.resolved || gone) || typing()));
  const [toggled, setToggled] = useState(false);
  const [wasResolved, setWasResolved] = useState(root.resolved);
  const add = useAddMessage();
  const archive = useArchiveThread();
  // An answer counts as seen once its thread has been on screen, open, wherever on the page that is.
  const box = useRef<HTMLDivElement>(null);
  const { mutate: markSeen } = useMarkSeen();
  const { data: session } = useSession();
  const unseen = open ? unseenReply(thread)?.id : undefined;
  useEffect(() => {
    if (!unseen || !box.current) {
      return;
    }
    const watch = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        watch.disconnect();
        markSeen(root.id);
      }
    });
    watch.observe(box.current);
    return () => watch.disconnect();
  }, [unseen, root.id, markSeen]);
  if (wasResolved !== root.resolved) {
    setWasResolved(root.resolved);
    setOpen(!root.resolved || typing());
  }
  if (root.status === "draft") {
    return <DraftNote message={root} />;
  }
  const answer = replies.findLast(m => m.from === "claude");
  const Toggle = open ? ChevronDown : ChevronRight;
  const entries = timeline(root, replies);
  // The session is saying what it's doing for this thread right now.
  const live = Boolean(session?.listening && session.activity?.thread === root.id);
  // Questions stand until the user has said something after them.
  const last = replies.at(-1);
  const asking = last?.from === "claude" && last.ask?.length && !root.archived ? last : undefined;
  return (
    <div
      ref={box}
      id={`t-${root.id}`}
      className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 border-l-2 border-l-primary/50 bg-card px-3 py-2.5 font-sans", className)}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
            setToggled(true);
          }}
          aria-expanded={open}
          className="inline-flex cursor-pointer items-center gap-1 font-medium text-foreground/80 hover:text-foreground"
        >
          <Toggle className="size-3.5" />
          {finding
            ? `Review ${root.review?.n} finding`
            : root.kind === "note"
              ? `Note to Claude${root.batch ? `, batch ${root.batch}` : ""}`
              : "Chat with Claude"}
          {root.anchor.kind === "line" && root.anchor.endLine && root.anchor.endLine !== root.anchor.line
            ? `, lines ${root.anchor.line} to ${root.anchor.endLine}`
            : ""}
        </button>
        <IntentBadge message={root} />
        <SeverityBadge message={root} />
        {finding && root.review?.recommended && !root.resolved && !gone && <Badge tone="primary">Act on this</Badge>}
        <StateBadge state={root.state} />
        {finding && <FindingBadges message={root} />}
        <Delivery message={root} />
        <Posted message={root} />
        {replies.length > 0 && !open && (
          <span className="text-muted-foreground">
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </span>
        )}
      </div>
      {open ? (
        <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-2", toggled && "motion-grow")}>
          {entries.map((entry, index) => {
            if ("steps" in entry) {
              return <Steps key={entry.steps[0]?.at} steps={entry.steps} running={live && index === entries.length - 1} />;
            }
            if ("note" in entry) {
              return <Note key={entry.note.at} note={entry.note} />;
            }
            const { message } = entry;
            return message === root ? (
              <Fragment key={message.id}>
                <Bubble message={message} />
                {finding && root.review?.patch && <Patch text={root.review.patch} />}
              </Fragment>
            ) : (
              // The gap is padding inside the box that grows, so the space opens with the message.
              <div key={message.id} className={cn("-mt-2", arrived(message.at) && "motion-arrive")}>
                <div className="pt-2">
                  <Bubble message={message} />
                </div>
              </div>
            );
          })}
          {asking && (
            <Ask message={asking} pending={add.isPending} onAnswer={text => add.mutate({ kind: "chat", text, replyTo: root.id })} />
          )}
          {!(live && "steps" in (entries.at(-1) ?? {})) && <Working thread={root.id} waiting={awaited(root, replies)} />}
          {finding && fixable(root, replies) && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={add.isPending} onClick={() => add.mutate({ kind: "chat", text: "Fix this.", replyTo: root.id })}>
                Fix this
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={archive.isPending}>
                    Dismiss
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {DISMISS_REASONS.map(reason => (
                    <DropdownMenuItem key={reason} onSelect={() => archive.mutate({ id: root.id, archived: true, reason })}>
                      {DISMISS_TEXT[reason]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          <ReplyBox replyTo={root.id} placeholder={root.resolved ? "Reopen it with a follow-up" : "Follow up with Claude"} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setToggled(true);
          }}
          className="cursor-pointer truncate text-left text-muted-foreground text-sm hover:text-foreground"
        >
          {answer ? `Claude: ${oneLine(answer.text)}` : oneLine(root.text)}
        </button>
      )}
    </div>
  );
}

const initials = (login: string | null) => (login ?? "?").slice(0, 2).toUpperCase();

function CommentView({ comment, layer }: { comment: GithubComment; layer: number }) {
  return (
    <div className="flex gap-2.5">
      <Avatar size="sm" className="mt-0.5">
        {comment.avatar && comment.author && (
          <AvatarImage src={`/api/layers/${layer}/comments/avatar/${encodeURIComponent(comment.author)}`} alt="" />
        )}
        <AvatarFallback>{initials(comment.author)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-xs">
          <span className="font-medium">{comment.author ?? "someone"}</span>
          <time dateTime={comment.at} title={fullDate(comment.at)} className="text-muted-foreground">
            {ago(comment.at)}
          </time>
          {comment.pending && <Badge tone="warning">Pending, only you can see it</Badge>}
        </div>
        <div className="mt-0.5 text-sm [overflow-wrap:anywhere]">
          <Markdown source={comment.body} layer={layer} />
        </div>
      </div>
    </div>
  );
}

// A review thread already on the pull request, in GitHub's grey rather than Claude's colour.
export function GithubThreadBlock({ view, className }: { view: GithubThreadView; className?: string }) {
  const { thread, layer } = view;
  const [open, setOpen] = useState(!thread.resolved);
  const [toggled, setToggled] = useState(false);
  const link = thread.comments.find(c => c.url)?.url;
  const Toggle = open ? ChevronDown : ChevronRight;
  return (
    <div className={cn("grid gap-2.5 border-l-2 border-l-foreground/30 bg-muted/50 px-3 py-2.5 font-sans", className)}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
            setToggled(true);
          }}
          aria-expanded={open}
          className="inline-flex cursor-pointer items-center gap-1 font-medium text-foreground/80 hover:text-foreground"
        >
          <Toggle className="size-3.5" />
          On GitHub
          {thread.startLine && thread.line && thread.startLine !== thread.line ? `, lines ${thread.startLine} to ${thread.line}` : ""}
        </button>
        {thread.resolved && <Badge tone="success">Resolved</Badge>}
        {thread.outdated && <Badge tone="outline">Outdated</Badge>}
        {!open && (
          <span className="min-w-0 truncate text-muted-foreground">
            {thread.comments.length} {thread.comments.length === 1 ? "comment" : "comments"}
          </span>
        )}
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-primary hover:underline">
            Open on GitHub <ExternalLink className="size-3" />
          </a>
        )}
      </div>
      {open && (
        <div className={cn("grid gap-2.5", toggled && "motion-grow")}>
          {thread.comments.map(comment => (
            <CommentView key={comment.id} comment={comment} layer={layer} />
          ))}
        </div>
      )}
    </div>
  );
}

// A thread as it shows under the thing it is about.
export function ThreadBlock({ thread }: { thread: Thread }) {
  return thread.kind === "github" ? <GithubThreadBlock view={thread} /> : <ClaudeThreadBlock thread={thread} />;
}
