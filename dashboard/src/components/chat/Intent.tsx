import { Check, ChevronDown } from "lucide-react";
import { NOTE_INTENTS, type NoteIntent } from "shared/intents";
import type { Message } from "shared/messages";

import { Badge } from "src/components/ui/badge";
import { Button } from "src/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "src/components/ui/dropdown-menu";

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

// Optional: No tag leaves the note unmarked, and Claude works out what it asks for.
export function IntentPicker({ value, onChange }: { value: NoteIntent | undefined; onChange: (intent: NoteIntent | undefined) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="px-2 pointer-coarse:h-11"
          aria-label={`What the note asks for: ${value ? LABEL[value] : "no tag"}`}
          title={value ? MEANS[value] : "Tag the note as a fix, a question or a nit"}
        >
          {value ? LABEL[value] : "Tag"}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {[...NOTE_INTENTS, undefined].map(intent => (
          <DropdownMenuItem
            key={intent ?? "none"}
            onSelect={() => onChange(intent)}
            className="grid grid-cols-[1rem_1fr] gap-x-2 pointer-coarse:py-3"
          >
            {value === intent ? <Check className="mt-0.5 size-4" /> : <span />}
            <span className="grid">
              {intent ? LABEL[intent] : "No tag"}
              <span className="text-muted-foreground text-xs">{intent ? MEANS[intent] : "Claude works out what it asks for"}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
