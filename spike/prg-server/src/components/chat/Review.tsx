import { Crosshair, Ellipsis, MessagesSquare, ScanSearch } from "lucide-react";
import type { Message } from "shared/messages";
import { REVIEW_EFFORTS, type ReviewEffort } from "shared/reviews";

import { useChatStore } from "src/components/chat/chat.store";
import { jumpTo, oneLine, shortLabel } from "src/components/chat/notes";
import { SeverityBadge, StateBadge } from "src/components/chat/ThreadBlock";
import { type ClaudeThread, useThreads } from "src/components/chat/useThreads";
import { Prose } from "src/components/links/Prose";
import { Button } from "src/components/ui/button";
import { ButtonGroup } from "src/components/ui/button-group";
import { Block } from "src/components/ui/disclosure";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "src/components/ui/dropdown-menu";
import { errorText, useRequestReview } from "src/queries/messages.mutation";
import { useReview } from "src/queries/review.query";

const layerOf = (message: Message) => ("layer" in message.anchor ? message.anchor.layer : undefined);

// The threads of the newest review of one PR that hasn't been archived: the user's request and Claude's findings.
function useLatestReview(layer: number) {
  const { threads } = useThreads();
  const mine = threads.filter(t => t.root.review && layerOf(t.root) === layer);
  const request = mine.findLast(t => t.root.from === "user");
  const findings = mine.filter((t): t is ClaudeThread => t.root.from === "claude" && t.root.review?.n === request?.root.review?.n);
  return { request, findings };
}

const DEFAULT_EFFORT: ReviewEffort = "medium";

// Asks Claude to run the code-review skill on this PR. The button itself asks at medium effort; the part joined to
// its right opens the other efforts, and picking one asks at that.
export function ReviewButton({ layer }: { layer: number }) {
  const { request } = useLatestReview(layer);
  const ask = useRequestReview();
  const running = request && !request.root.resolved ? request.root.review?.n : undefined;
  const busy = running !== undefined || ask.isPending;
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {ask.isError && <span className="text-danger text-sm">{errorText(ask.error, "That didn't send.")}</span>}
      <ButtonGroup>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          title={`Review this pull request at ${DEFAULT_EFFORT} effort`}
          onClick={() => ask.mutate({ layer, effort: DEFAULT_EFFORT })}
        >
          <ScanSearch />
          {running === undefined ? "Ask Claude for a review" : `Review ${running} running…`}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="px-2" disabled={busy} aria-label="Review effort">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {REVIEW_EFFORTS.map(effort => (
              <DropdownMenuItem key={effort} onSelect={() => ask.mutate({ layer, effort })}>
                {effort}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
    </span>
  );
}

// What the latest review found, in the same list as the other things to settle: Claude's recommendation, then each
// finding with where it is, whether Claude says to act on it, and what has become of it.
export function ReviewBlock({ layer }: { layer: number }) {
  const review = useReview().data;
  const openThread = useChatStore(state => state.openThread);
  const { request, findings } = useLatestReview(layer);
  if (!request) {
    return null;
  }
  const answer = request.replies.findLast(m => m.from === "claude");
  return (
    <Block
      title={`Claude's review${answer ? ` (${findings.length})` : ""}`}
      note={
        <p className="mt-1.5 text-[13.5px] text-muted-foreground">
          {answer ? (
            <Prose text={answer.text} layer={layer} />
          ) : (
            "Claude is reviewing this pull request. Findings show here as they arrive."
          )}
        </p>
      }
    >
      {findings.map(({ root }) => (
        <li key={root.id}>
          {root.review?.recommended && <b className="font-semibold">Act on this: </b>}
          {root.anchor.loc && (
            <>
              <button
                type="button"
                className="cursor-pointer font-mono text-xs underline decoration-dotted decoration-muted-foreground underline-offset-[3px] hover:text-primary"
                onClick={() => jumpTo(root.anchor, review)}
              >
                <Crosshair className="mr-1 inline size-3" />
                {shortLabel(root.anchor)}
              </button>{" "}
            </>
          )}
          {oneLine(root.text.split("\n")[0] ?? "")} <SeverityBadge message={root} /> <StateBadge state={root.state} />
          <button
            type="button"
            title="Open this finding's thread"
            aria-label="Open this finding's thread"
            className="ml-1 inline-flex cursor-pointer align-middle text-muted-foreground hover:text-primary"
            onClick={() => openThread(root.id)}
          >
            <MessagesSquare className="size-3.5" />
          </button>
        </li>
      ))}
    </Block>
  );
}
