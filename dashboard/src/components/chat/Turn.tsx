import { Check, X } from "lucide-react";
import type { Me, Message } from "shared/messages";
import { type Turn, turnOf } from "shared/turn";

import { useChatStore } from "src/components/chat/chat.store";
import type { ClaudeThread } from "src/components/chat/useThreads";
import { handleOf } from "src/components/links/Github";
import { Badge } from "src/components/ui/badge";
import { useMe } from "src/queries/me.query";
import { useLayer } from "src/queries/review.query";
import { useViewStore } from "src/store/view.store";

// Whether a thread waits on the reader.
export const yours = (turn: Turn, me: Me | undefined) =>
  turn === "owner" ? me?.role === "owner" : typeof turn === "number" && me?.role === "guest" && me.person?.id === turn;

// Who a thread waits on, when that is a person. Claude's turn already shows as its work on the thread.
export function TurnBadge({ thread }: { thread: ClaudeThread }) {
  const me = useMe();
  const turn = turnOf(thread.root, thread.replies);
  if (turn === null || turn === "claude") {
    return null;
  }
  if (yours(turn, me)) {
    return <Badge tone="primary">Your turn</Badge>;
  }
  const guest = [thread.root, ...thread.replies].find(m => m.author?.id === turn)?.author;
  return <Badge tone="outline">Waiting on {turn === "owner" || !guest ? "the owner" : handleOf(guest)}</Badge>;
}

// Under Claude's answer that something is fixed: where the change is, as a jump when the diff has that file, and
// each check it ran with how it went.
export function FixNote({ message, layer }: { message: Message; layer: number }) {
  const shown = useLayer(layer);
  const goTo = useViewStore(state => state.goTo);
  const setChatOpen = useChatStore(state => state.setChatOpen);
  const { fix, checks } = message;
  if (!fix && !checks) {
    return null;
  }
  const file = fix && shown?.files.find(f => f.path === fix.file.replace(/^\.\//, ""));
  const onLine = file?.hunks.some(hunk => hunk.lines.some(row => row[2] === fix?.line));
  const target = file && (onLine ? `${file.id}:R${fix.line}` : file.id);
  const where = fix && `${fix.file}${fix.line ? `:${fix.line}` : ""}`;
  return (
    <div className="mt-1.5 grid gap-1 text-xs">
      {fix && (
        <p className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-muted-foreground">Changed in</span>
          {target ? (
            <button
              type="button"
              className="cursor-pointer text-left font-mono text-primary [overflow-wrap:anywhere] hover:underline"
              onClick={() => {
                goTo(layer, target);
                setChatOpen(false);
              }}
            >
              {where}
            </button>
          ) : (
            <span className="font-mono [overflow-wrap:anywhere]">{where}</span>
          )}
        </p>
      )}
      {checks && (
        <ul className="grid gap-0.5" aria-label="Checks Claude ran">
          {checks.map(check => (
            <li key={check.run} className="flex items-start gap-1.5">
              {check.passed ? (
                <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
              ) : (
                <X aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger" />
              )}
              <span className="sr-only">{check.passed ? "Passed:" : "Failed:"}</span>
              <code className="font-mono [overflow-wrap:anywhere]">{check.run}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
