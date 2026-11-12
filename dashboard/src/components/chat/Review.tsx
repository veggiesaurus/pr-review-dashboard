import { Crosshair, Ellipsis, MessagesSquare, ScanSearch } from "lucide-react";
import type { Message } from "shared/messages";
import { fixable, REVIEW_EFFORTS, type ReviewEffort, STANDINGS, standing } from "shared/reviews";

import { useChatStore } from "src/components/chat/chat.store";
import { jumpTo, oneLine, shortLabel } from "src/components/chat/notes";
import { FindingBadges, SeverityBadge, StateBadge } from "src/components/chat/ThreadBlock";
import { type ClaudeThread, useThreads } from "src/components/chat/useThreads";
import { Prose } from "src/components/links/Prose";
import { Button } from "src/components/ui/button";
import { ButtonGroup } from "src/components/ui/button-group";
import { Block } from "src/components/ui/disclosure";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "src/components/ui/dropdown-menu";
import { errorText, useFixRecommended, useRequestReview } from "src/queries/messages.mutation";
import { useLayer, useReview } from "src/queries/review.query";
import { progressKeys, useTickedCount } from "src/store/ticks.store";
import { cn } from "src/utils/cn";

const layerOf = (message: Message) => ("layer" in message.anchor ? message.anchor.layer : undefined);

// The newest review of one PR that hasn't been archived: the user's request and Claude's findings, those the user
// dismissed among them, in the order of where they stand.
function useLatestReview(layer: number) {
  const { threads, archived } = useThreads();
  const request = threads.findLast(t => t.root.review && t.root.from === "user" && layerOf(t.root) === layer);
  const findings = [...threads, ...archived.filter(t => t.root.review?.dismissed)]
    .filter((t): t is ClaudeThread => t.root.from === "claude" && t.root.review?.n === request?.root.review?.n)
    .sort((a, b) => STANDINGS.indexOf(standing(a.root)) - STANDINGS.indexOf(standing(b.root)));
  return { request, findings };
}

const DEFAULT_EFFORT: ReviewEffort = "medium";

// Asks Claude to run the code-review skill on this PR. The button itself asks at medium effort; the part joined to
// its right opens the other efforts, and picking one asks at that. It stays quiet until every guide section is
// ticked: a review read first narrows where its reader looks.
export function ReviewButton({ layer }: { layer: number }) {
  const { request } = useLatestReview(layer);
  const ask = useRequestReview();
  const shown = useLayer(layer);
  const keys = shown ? progressKeys(shown) : [];
  const read = useTickedCount(keys) === keys.length;
  const variant = read ? "default" : "outline";
  const running = request && !request.root.resolved ? request.root.review?.n : undefined;
  const busy = running !== undefined || ask.isPending;
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {ask.isError && <span className="text-danger text-sm">{errorText(ask.error, "That didn't send.")}</span>}
      {!read && running === undefined && (
        <span className="text-muted-foreground text-xs" title="A review read first narrows where you look.">
          Best after your own read
        </span>
      )}
      <ButtonGroup>
        <Button
          size="sm"
          variant={variant}
          disabled={busy}
          title={`Review this pull request at ${DEFAULT_EFFORT} effort`}
          onClick={() => ask.mutate({ layer, effort: DEFAULT_EFFORT })}
        >
          <ScanSearch />
          {running === undefined ? "Ask Claude for a review" : `Review ${running} running…`}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant={variant}
              // The group drops the border between its parts, so the primary pair is divided by a shadow.
              className={cn("px-2", read && "shadow-[inset_1px_0_0_color-mix(in_oklch,var(--primary-foreground)_35%,transparent)]")}
              disabled={busy}
              aria-label="Review effort"
            >
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

const NOTE = "mt-1.5 text-[13.5px] text-muted-foreground";

// What the latest review found, in the same list as the other things to settle: Claude's recommendation, how many
// findings stand where, then each with where it is, whether Claude says to act on it, and what has become of it.
export function ReviewBlock({ layer }: { layer: number }) {
  const review = useReview().data;
  const openThread = useChatStore(state => state.openThread);
  const fix = useFixRecommended();
  const { request, findings } = useLatestReview(layer);
  const n = request?.root.review?.n;
  if (!request || n === undefined) {
    return null;
  }
  const answer = request.replies.findLast(m => m.from === "claude");
  const counts = STANDINGS.map(name => ({ name, count: findings.filter(t => standing(t.root) === name).length })).filter(c => c.count);
  // The same findings the server sends: recommended, with nothing asked of them still waiting on an answer.
  const toFix = findings.filter(t => t.root.review?.recommended && fixable(t.root, t.replies)).length;
  return (
    <Block
      title={`Claude's review${answer ? ` (${findings.length})` : ""}`}
      note={
        <>
          <p className={NOTE}>
            {answer ? (
              <Prose text={answer.text} layer={layer} />
            ) : (
              "Claude is reviewing this pull request. Findings show here as they arrive."
            )}
          </p>
          {answer && findings.length === 0 && (
            <p className={NOTE}>No findings isn't a pass: a review like this catches a minority of what people flag.</p>
          )}
          {findings.length > 0 && (
            <p className={cn(NOTE, "flex flex-wrap items-center gap-x-3 gap-y-1.5")}>
              {counts.map(c => `${c.count} ${c.name}`).join(", ")}
              {toFix > 0 && (
                <Button size="sm" variant="outline" className="text-foreground" disabled={fix.isPending} onClick={() => fix.mutate(n)}>
                  Fix the recommended ({toFix})
                </Button>
              )}
            </p>
          )}
        </>
      }
    >
      {findings.map(({ root }) => {
        const open = standing(root) === "open";
        return (
          <li key={root.id} className={cn(!open && "text-muted-foreground")}>
            {root.review?.recommended && open && <b className="font-semibold">Act on this: </b>}
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
            {oneLine(root.text.split("\n")[0] ?? "")} <SeverityBadge message={root} /> <StateBadge state={root.state} />{" "}
            <FindingBadges message={root} />
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
        );
      })}
    </Block>
  );
}
