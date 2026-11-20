import type { Message } from "shared/messages";
import type { Tried } from "shared/tries";

import { Screenshots } from "src/components/chat/Screenshots";
import { MessageText } from "src/components/links/Markdown";
import { Badge, type Tone } from "src/components/ui/badge";
import { Summary } from "src/components/ui/disclosure";

const TRIED_LABEL: Record<Tried, string> = {
  passed: "Claude tried it: passed",
  failed: "Claude tried it: failed",
  blocked: "Claude couldn't try it",
};
const TRIED_TONE: Record<Tried, Tone> = { passed: "success", failed: "danger", blocked: "outline" };

// What Claude found when it tried a step: how it went, then what it did, folded unless open says otherwise.
// head is the head on show, so an answer from an earlier one says it is.
export function TriedAnswer({ answer, layer, head, open }: { answer: Message; layer: number; head: string; open?: boolean }) {
  if (!answer.tried) {
    return null;
  }
  const { outcome } = answer.tried;
  return (
    <details data-tried={outcome} open={open} className="mt-1">
      <Summary>
        <Badge tone={TRIED_TONE[outcome]}>{TRIED_LABEL[outcome]}</Badge>
        {answer.tried.head !== head && <span className="text-muted-foreground">before the latest changes</span>}
      </Summary>
      <div className="mt-1.5 grid gap-2 border-l-2 pl-3">
        <MessageText text={answer.text} layer={layer} />
        <Screenshots ids={answer.images} large />
      </div>
    </details>
  );
}
