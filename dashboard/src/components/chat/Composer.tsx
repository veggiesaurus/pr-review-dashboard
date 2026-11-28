import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { NoteIntent } from "shared/intents";
import type { Anchor } from "shared/messages";

import { composerText, saveComposerText, useChatStore } from "src/components/chat/chat.store";
import { IntentPicker } from "src/components/chat/Intent";
import { MarkdownEditor } from "src/components/chat/MarkdownEditor";
import { describe } from "src/components/chat/notes";
import { Screenshots, useScreenshots } from "src/components/chat/Screenshots";
import { Button } from "src/components/ui/button";
import { ButtonGroup } from "src/components/ui/button-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "src/components/ui/dropdown-menu";
import { Kbd } from "src/components/ui/kbd";
import { errorText, useAddMessage } from "src/queries/messages.mutation";
import { useReview } from "src/queries/review.query";
import { anchorKey } from "src/utils/anchors";

const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KEYS = { note: MAC ? "⌘↵" : "Ctrl+Enter", ask: MAC ? "⇧↵" : "Shift+Enter" };

// A note kept as a draft for the batch, or a question that goes to Claude at once. What is typed is kept in this
// browser as it is typed, so a reload doesn't lose it.
// bare leaves out the line saying what it is about, for where the drawer already says so.
export function Composer({ anchor, label, bare = false }: { anchor: Anchor; label?: string; bare?: boolean }) {
  const [text, setText] = useState(() => composerText(anchor));
  const [intent, setIntent] = useState<NoteIntent>();
  const close = useChatStore(state => state.closeComposer);
  const review = useReview().data;
  const add = useAddMessage();
  const shots = useScreenshots();
  const empty = text.trim() === "";
  const blocked = empty || add.isPending || shots.uploading;
  const where = label ?? describe(anchor, review);

  const update = (value: string) => {
    setText(value);
    saveComposerText(anchor, value);
  };
  const cancel = () => {
    saveComposerText(anchor, "");
    close();
  };
  const submit = (kind: "note" | "chat" | "post") => {
    if (!empty && !add.isPending && !shots.uploading) {
      add.mutate(
        { kind, text, anchor, ...(kind === "note" && intent && { intent }), ...(shots.images.length && { images: shots.images }) },
        {
          onSuccess: () => {
            saveComposerText(anchor, "");
            setText("");
            setIntent(undefined);
            shots.clear();
            if (anchor.kind === "line") {
              close();
            }
          },
        },
      );
    }
  };

  return (
    <div className="grid gap-2 border-y bg-card px-3 py-2.5 font-sans" {...shots.handlers}>
      {!bare && <p className="font-mono text-muted-foreground text-xs [overflow-wrap:anywhere]">{where}</p>}
      <MarkdownEditor
        autoFocus
        value={text}
        onChange={update}
        onSend={shift => submit(shift ? "chat" : "note")}
        onEscape={close}
        onFiles={shots.take}
        sendKey="mod-enter"
        label={`Note or question about ${where}`}
        placeholder="A note, or a question for Claude"
        className="[&_.ProseMirror]:min-h-16"
      />
      <Screenshots ids={shots.images} onRemove={shots.remove} />
      <div className="flex flex-wrap items-center gap-2">
        <IntentPicker value={intent} onChange={setIntent} />
        {shots.uploading && <span className="text-muted-foreground text-sm">Attaching…</span>}
        {shots.error && <span className="text-danger text-sm">{shots.error}</span>}
        {add.isError && <span className="text-danger text-sm">{errorText(add.error, "That didn't save.")}</span>}
        <span className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" className="pointer-coarse:h-11" onClick={cancel}>
            Cancel
          </Button>
          <ButtonGroup>
            <Button
              size="sm"
              className="pointer-coarse:h-11"
              onClick={() => submit("note")}
              disabled={blocked}
              title={`Kept as a draft until you send your notes (${KEYS.note})`}
            >
              Add to notes
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  // The group drops the border between its parts, so the pair is divided by a shadow.
                  className="px-2 shadow-[inset_1px_0_0_color-mix(in_oklch,var(--primary-foreground)_35%,transparent)] pointer-coarse:h-11 pointer-coarse:px-3"
                  disabled={blocked}
                  aria-label="Ask Claude now, or post for reviewers"
                >
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => submit("chat")} className="flex items-center gap-4 pointer-coarse:py-3">
                  Ask Claude now
                  <Kbd className="ml-auto">{KEYS.ask}</Kbd>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => submit("post")} className="grid pointer-coarse:py-3">
                  Post for reviewers
                  <span className="text-muted-foreground text-xs">Everyone on the review sees it; Claude doesn't</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ButtonGroup>
        </span>
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
