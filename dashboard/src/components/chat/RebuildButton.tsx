import { RefreshCw } from "lucide-react";

import { useChatStore } from "src/components/chat/chat.store";
import { useThreads } from "src/components/chat/useThreads";
import { Tooltip, TooltipContent, TooltipTrigger } from "src/components/ui/tooltip";
import { useAddMessage } from "src/queries/messages.mutation";
import { useSession } from "src/queries/messages.query";
import { cn } from "src/utils/cn";

// SESSION.md's "Rebuilding the guide" starts from these words.
const ASK = "Rebuild the guide at the pull requests' current heads, keeping what hasn't changed.";

// Asks the session to rebuild, as a chat thread so its progress and answer show where the rest of the chat does.
export function RebuildButton() {
  const { threads } = useThreads();
  const add = useAddMessage();
  const openThread = useChatStore(state => state.openThread);
  const running = threads.find(
    t => t.root.from === "user" && t.root.text === ASK && (t.root.state === "open" || t.root.state === "working"),
  );
  // Asked for but with no session listening, it waits on the server, and the button opens it rather than asking twice.
  const listening = Boolean(useSession().data?.listening);
  const busy = running !== undefined && listening;
  const label = busy ? "Rebuilding the guide…" : running ? "Rebuild the guide (waiting for a session)" : "Rebuild the guide";
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() =>
            running
              ? openThread(running.root.id)
              : add.mutate({ kind: "chat", text: ASK }, { onSuccess: message => openThread(message.id) })
          }
          disabled={add.isPending}
          aria-label={label}
          className="flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-transparent px-2 text-muted-foreground text-sm hover:border-border hover:bg-card hover:text-foreground focus-visible:border-border focus-visible:bg-card focus-visible:text-foreground disabled:opacity-60"
        >
          <RefreshCw className={cn("size-4", busy && "animate-spin [animation-duration:2s]")} />
          {busy ? "Rebuilding…" : "Rebuild"}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        {busy
          ? "Claude is rebuilding the guide; open its thread"
          : running
            ? "A rebuild is waiting for a session to listen; open its thread"
            : "Ask Claude to rebuild the guide, writing only what changed since this one"}
      </TooltipContent>
    </Tooltip>
  );
}
