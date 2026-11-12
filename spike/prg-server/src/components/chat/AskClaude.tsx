import { MessageSquarePlus, MessagesSquare } from "lucide-react";
import type { Anchor } from "shared/messages";

import { openComposer, useChatStore } from "src/components/chat/chat.store";
import { useThreadsAbout } from "src/components/chat/useThreads";
import { anchorKey } from "src/utils/anchors";
import { cn } from "src/utils/cn";

// A small button that opens the composer for one thing on the page. Once there are threads about it, it says how
// many and opens them instead; data-ask lets the drawer find the row it sits in.
export function AskClaude({ anchor, label, className }: { anchor: Anchor; label?: string; className?: string }) {
  const threads = useThreadsAbout(anchor);
  const openThread = useChatStore(state => state.openThread);
  const working = threads.some(t => t.root.state === "working");
  const open = threads.filter(t => !t.root.resolved).length;
  const title = threads.length
    ? `${threads.length} ${threads.length === 1 ? "thread" : "threads"} with Claude about this`
    : (label ?? "Ask Claude about this");

  const click = () => {
    const [only] = threads;
    if (threads.length === 1 && only && anchor.kind !== "line") {
      openThread(only.root.id);
    } else {
      openComposer(anchor);
    }
  };

  return (
    <button
      type="button"
      data-ask={anchorKey(anchor)}
      onClick={click}
      title={title}
      aria-label={title}
      className={cn("inline-flex cursor-pointer items-center gap-1 text-muted-foreground text-xs hover:text-primary", className)}
    >
      {threads.length ? <MessagesSquare className="size-3.5 text-primary" /> : <MessageSquarePlus className="size-3.5" />}
      {label}
      {threads.length > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 font-medium text-[11px] leading-4",
            working ? "bg-warning/14 text-warning" : open ? "bg-primary/12 text-primary" : "bg-success/12 text-success",
          )}
        >
          {threads.length}
        </span>
      )}
    </button>
  );
}
