import { NOTE_INTENTS, type NoteIntent } from "shared/intents";
import type { Message } from "shared/messages";

import { Badge } from "src/components/ui/badge";

const LABEL: Record<NoteIntent, string> = { fix: "Fix", question: "Question", nit: "Nit" };
const MEANS: Record<NoteIntent, string> = {
  fix: "Claude makes the change",
  question: "Claude answers and changes nothing",
  nit: "Claude fixes it only if it is trivial",
};

// What a note asks for, when its writer said.
export function IntentBadge({ message }: { message: Message }) {
  return message.intent ? (
    <Badge tone="outline" title={MEANS[message.intent]}>
      {LABEL[message.intent]}
    </Badge>
  ) : null;
}

// Optional: pressing the chosen one again leaves the note unmarked, and Claude works out what it asks for.
export function IntentPicker({ value, onChange }: { value: NoteIntent | undefined; onChange: (intent: NoteIntent | undefined) => void }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset brings its own border and legend layout
    <div role="group" aria-label="What the note asks for" className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
      Mark the note as
      {NOTE_INTENTS.map(intent => (
        <button
          key={intent}
          type="button"
          aria-pressed={value === intent}
          title={MEANS[intent]}
          onClick={() => onChange(value === intent ? undefined : intent)}
          className="cursor-pointer rounded-full"
        >
          <Badge tone={value === intent ? "primary" : "outline"}>{LABEL[intent]}</Badge>
        </button>
      ))}
    </div>
  );
}
