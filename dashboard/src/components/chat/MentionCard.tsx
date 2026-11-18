import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Message } from "shared/messages";

import { useChatStore } from "src/components/chat/chat.store";
import { describe } from "src/components/chat/notes";
import { mentionsOf, unread, useThreads } from "src/components/chat/useThreads";
import { Button } from "src/components/ui/button";
import { useMe } from "src/queries/me.query";
import { useMessages } from "src/queries/messages.query";
import { useReview } from "src/queries/review.query";

type Mention = { message: Message; root: Message };

// Someone named me since the page loaded: a card for a few seconds, with the way to the thread.
export function MentionCard() {
  const me = useMe()?.person?.id;
  const { data: messages } = useMessages();
  const { threads, archived } = useThreads();
  const review = useReview().data;
  const openThread = useChatStore(state => state.openThread);
  const known = useRef<Set<string> | null>(null);
  const [shown, setShown] = useState<Mention[]>([]);

  useEffect(() => {
    if (me === undefined || !messages) {
      return;
    }
    const waiting = [...threads, ...archived].flatMap(t =>
      mentionsOf(t, me).flatMap(message => (unread(t.root, message) ? [{ message, root: t.root }] : [])),
    );
    // What was already waiting when the page loaded is the notes panel's to show.
    if (!known.current) {
      known.current = new Set(waiting.map(m => m.message.id));
      return;
    }
    const seen = known.current;
    const fresh = waiting.filter(m => !seen.has(m.message.id));
    for (const m of fresh) {
      seen.add(m.message.id);
    }
    if (fresh.length) {
      setShown(now => [...now, ...fresh]);
    }
  }, [me, messages, threads, archived]);

  const latest = shown.at(-1);
  useEffect(() => {
    if (!latest) {
      return;
    }
    const timer = setTimeout(() => setShown([]), 10_000);
    return () => clearTimeout(timer);
  }, [latest]);

  const author = latest?.message.author;
  const name = author ? author.name || author.login : "Owner";
  // Always mounted, so a screen reader hears the card when it fills.
  return (
    <div role="status" className="fixed right-4 bottom-20 z-50 w-80 max-w-[calc(100vw-2rem)]">
      {latest && (
        <div className="motion-fade relative grid gap-2 rounded-lg border bg-popover p-3 text-popover-foreground text-sm shadow-md">
          <p className="pr-6 [overflow-wrap:anywhere]">
            <span className="font-medium">{name}</span> mentioned you on {describe(latest.root.anchor, review).replace(/^The /, "the ")}
            {shown.length > 1 && <span className="text-muted-foreground"> and {shown.length - 1} more</span>}
          </p>
          <Button
            size="sm"
            className="justify-self-start"
            onClick={() => {
              openThread(latest.root.id);
              setShown([]);
            }}
          >
            Jump to
          </Button>
          <Button variant="ghost" size="icon" className="absolute top-1.5 right-1.5 size-7" onClick={() => setShown([])} aria-label="Close">
            <X />
          </Button>
        </div>
      )}
    </div>
  );
}
