import { ExternalLink, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { PostMode, PostPreview } from "shared/comments";

import { useChatStore } from "src/components/chat/chat.store";
import { shortLabel } from "src/components/chat/notes";
import { Button } from "src/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "src/components/ui/dialog";
import { usePostReview, usePreviewReview } from "src/queries/comments.query";
import { errorText } from "src/queries/messages.mutation";
import { useMessages } from "src/queries/messages.query";
import { cn } from "src/utils/cn";

const MODES: { mode: PostMode; title: string; text: string }[] = [
  { mode: "pending", title: "As a pending review", text: "Only you can see it until you submit the review on GitHub." },
  { mode: "now", title: "Post now", text: "A comment review everyone on the pull request sees and is notified of." },
];

// Shows exactly what would go to the pull request, where, and under whose login, and posts only when confirmed.
// The server works the comments out from the notes and refuses the post if any of it changed since this preview.
export function PostDialog({ layer, ids: picked, onClose }: { layer: number; ids: string[]; onClose: () => void }) {
  // The notes picked when it opened; the panel behind it can change while it is open.
  const [ids] = useState(picked);
  const [mode, setMode] = useState<PostMode>("pending");
  const [summary, setSummary] = useState("");
  const [asked, setAsked] = useState("");
  const [keep, setKeep] = useState(false);
  const preview = usePreviewReview(layer);
  const post = usePostReview(layer);
  const setPicked = useChatStore(state => state.setPicked);
  const shown: PostPreview | undefined = preview.data;
  const { data: messages } = useMessages();
  const { mutate } = preview;

  useEffect(() => {
    mutate({ ids, mode, summary: asked });
  }, [mutate, ids, mode, asked]);

  const confirm = () => {
    if (shown) {
      post.mutate({ ids, mode: shown.mode, summary: shown.summary, confirm: shown.confirm, keep }, { onSuccess: () => setPicked([]) });
    }
  };
  const blocked = !shown || shown.comments.length === 0 || (shown.mode === "pending" && shown.pendingExists) || summary.trim() !== asked;

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogTitle>Post notes to GitHub</DialogTitle>
        {post.isSuccess ? (
          <div className="grid gap-3 text-sm">
            <p>
              Posted {post.data.posted} {post.data.posted === 1 ? "comment" : "comments"}
              {post.data.pending ? " as a pending review. Submit it on GitHub when you're ready." : "."}
            </p>
            {post.data.url && (
              <a
                href={post.data.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Open the review on GitHub <ExternalLink className="size-3.5" />
              </a>
            )}
            <div>
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            <DialogDescription>
              {shown ? (
                <>
                  To <span className="font-mono text-foreground">{`${shown.repo}#${shown.number}`}</span> as{" "}
                  <span className="font-medium text-foreground">{shown.login}</span> on GitHub, against commit{" "}
                  <span className="font-mono text-foreground">{shown.commit.slice(0, 7)}</span>, the one this guide was built from.
                </>
              ) : preview.isError ? (
                "Nothing can be posted."
              ) : (
                "Asking GitHub who you are and checking each note…"
              )}
            </DialogDescription>
            {preview.isError && <p className="text-danger text-sm">{errorText(preview.error)}</p>}

            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">How to post</legend>
              {MODES.map(option => (
                <label
                  key={option.mode}
                  className={cn(
                    "flex cursor-pointer gap-2 rounded-md border p-2.5 text-sm",
                    mode === option.mode ? "border-primary bg-primary/6" : "hover:bg-muted/60",
                  )}
                >
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === option.mode}
                    onChange={() => setMode(option.mode)}
                    className="mt-1 accent-primary"
                  />
                  <span>
                    <span className="font-medium">{option.title}</span>
                    <span className="block text-muted-foreground text-xs">{option.text}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {shown?.mode === "pending" && shown.pendingExists && (
              <p className="flex gap-2 rounded-md border border-warning bg-warning/10 p-2.5 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                You already have a pending review on this pull request, and GitHub allows one. Submit or discard it there first, or post
                now.
              </p>
            )}

            <label className="grid gap-1 text-sm">
              <span className="font-medium">Review summary (optional)</span>
              <textarea
                value={summary}
                onChange={event => setSummary(event.target.value)}
                onBlur={() => setAsked(summary.trim())}
                rows={2}
                maxLength={4000}
                className="w-full resize-y rounded-md border border-input bg-background p-2 text-sm"
              />
              {summary.trim() !== asked && (
                <button
                  type="button"
                  onClick={() => setAsked(summary.trim())}
                  className="cursor-pointer justify-self-start text-primary text-xs hover:underline"
                >
                  Check it with the summary
                </button>
              )}
            </label>

            {shown && shown.comments.length > 0 && (
              <div className="grid gap-2">
                <h3 className="font-medium text-sm">
                  {shown.comments.length} inline {shown.comments.length === 1 ? "comment" : "comments"}, exactly as they will appear
                </h3>
                <ul className="grid gap-2">
                  {shown.comments.map(comment => (
                    <li key={comment.id} className="grid gap-1 rounded-md border bg-background px-2.5 py-2">
                      <span className="font-mono text-muted-foreground text-xs [overflow-wrap:anywhere]">
                        {comment.path}, {comment.startLine ? `lines ${comment.startLine} to ${comment.line}` : `line ${comment.line}`} (
                        {comment.side === "LEFT" ? "the base" : "the change"})
                      </span>
                      <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{comment.body}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {shown && shown.refused.length > 0 && (
              <div className="grid gap-1 text-sm">
                <h3 className="font-medium">Not posted</h3>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {shown.refused.map(note => {
                    const message = messages?.find(m => m.id === note.id);
                    return (
                      <li key={note.id}>
                        {message ? shortLabel(message.anchor) : note.id}: {note.reason}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={keep} onChange={event => setKeep(event.target.checked)} className="accent-primary" />
              Keep them in your notes for Claude as well
            </label>
            {post.isError && <p className="text-danger text-sm">{errorText(post.error)}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={confirm} disabled={blocked || post.isPending || preview.isPending}>
                {mode === "pending" ? "Start a pending review" : `Post ${shown?.comments.length ?? ""} now as ${shown?.login ?? "you"}`}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
