import { useState } from "react";
import type { NoteIntent } from "shared/intents";
import type { Anchor } from "shared/messages";

import { composerText, saveComposerText, useChatStore } from "src/components/chat/chat.store";
import { IntentPicker } from "src/components/chat/Intent";
import { describe } from "src/components/chat/notes";
import { Button } from "src/components/ui/button";
import { errorText, useAddMessage } from "src/queries/messages.mutation";
import { useReview } from "src/queries/review.query";
import { anchorKey } from "src/utils/anchors";

// A note kept as a draft for the batch, or a question that goes to Claude at once. What is typed is kept in this
// browser as it is typed, so a reload doesn't lose it.
// bare leaves out the line saying what it is about, for where the drawer already says so.
export function Composer({ anchor, label, bare = false }: { anchor: Anchor; label?: string; bare?: boolean }) {
  const [text, setText] = useState(() => composerText(anchor));
  const [intent, setIntent] = useState<NoteIntent>();
  const close = useChatStore(state => state.closeComposer);
  const review = useReview().data;
  const add = useAddMessage();
  const empty = text.trim() === "";
  const where = label ?? describe(anchor, review);

  const update = (value: string) => {
    setText(value);
    saveComposerText(anchor, value);
  };
  const cancel = () => {
    saveComposerText(anchor, "");
    close();
  };
  const submit = (kind: "note" | "chat") => {
    if (!empty) {
      add.mutate(
        { kind, text, anchor, ...(kind === "note" && intent && { intent }) },
        {
          onSuccess: () => {
            saveComposerText(anchor, "");
            setText("");
            setIntent(undefined);
            if (anchor.kind === "line") {
              close();
            }
          },
        },
      );
    }
  };

  return (
    <div className="grid gap-2 border-y bg-card px-3 py-2.5 font-sans">
      {!bare && <p className="font-mono text-muted-foreground text-xs [overflow-wrap:anywhere]">{where}</p>}
      <textarea
        // biome-ignore lint/a11y/noAutofocus: the box opens because something was clicked
        autoFocus
        value={text}
        onChange={event => update(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Escape") {
            close();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            submit(event.shiftKey ? "chat" : "note");
          }
        }}
        rows={3}
        maxLength={4000}
        placeholder="A note for the batch, or a question for Claude now"
        aria-label={`Note or question about ${where}`}
        className="block w-full resize-y rounded-md border border-input bg-background p-2 text-sm placeholder:text-muted-foreground"
      />
      <IntentPicker value={intent} onChange={setIntent} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => submit("note")}
          disabled={empty || add.isPending}
          title="Kept as a draft until you send your notes (⌘↵)"
        >
          Add note
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => submit("chat")}
          disabled={empty || add.isPending}
          title="Goes to Claude now (⇧⌘↵)"
        >
          Ask Claude now
        </Button>
        <Button size="sm" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
        {add.isError && <span className="text-danger text-sm">{errorText(add.error, "That didn't save.")}</span>}
      </div>
    </div>
  );
}

// Where a composer for this anchor opens, such as under a line; renders nothing until it is opened for it.
export function ComposerSlot({ anchor }: { anchor: Anchor }) {
  const key = anchorKey(anchor);
  const open = useChatStore(state => (state.composer ? anchorKey(state.composer) === key : false));
  return open ? <Composer anchor={anchor} /> : null;
}
