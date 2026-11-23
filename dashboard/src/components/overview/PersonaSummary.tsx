import { Check, Copy } from "lucide-react";
import { Fragment, useState } from "react";
// Types only: a value from shared/payload would bring its zod schemas into the page, and zod's probe for eval trips the CSP.
import type { Persona, Summary, SummaryReader } from "shared/payload";
import { type SummaryPart, summaryParts } from "shared/summary";

import { AskClaude } from "src/components/chat/AskClaude";
import { Prose } from "src/components/links/Prose";
import { Button } from "src/components/ui/button";
import { ButtonGroup } from "src/components/ui/button-group";
import { useViewStore } from "src/store/view.store";

// Each paragraph, and each run of list items, with every part open to a thread of its own.
function Parts({ parts, layer, reader }: { parts: SummaryPart[]; layer: number; reader: SummaryReader }) {
  const blocks: { item: boolean; parts: [SummaryPart, number][] }[] = [];
  parts.forEach((part, index) => {
    const last = blocks.at(-1);
    if (part.item && last?.item) {
      last.parts.push([part, index]);
    } else {
      blocks.push({ item: part.item, parts: [[part, index]] });
    }
  });
  const ask = (index: number) => <AskClaude anchor={{ kind: "summary", layer, reader, index }} className="ml-1 align-middle" />;
  return blocks.map(block =>
    block.item ? (
      <ul key={block.parts[0]?.[1]} className="grid list-disc gap-1 pl-5">
        {block.parts.map(([part, index]) => (
          <li key={index} data-part>
            <Prose text={part.text} layer={layer} />
            {ask(index)}
          </li>
        ))}
      </ul>
    ) : (
      <Fragment key={block.parts[0]?.[1]}>
        {block.parts.map(([part, index]) => (
          <p key={index} data-part>
            <Prose text={part.text} layer={layer} />
            {ask(index)}
          </p>
        ))}
      </Fragment>
    ),
  );
}

// The guide's summary of the whole change, one version for each persona it was written for, in their order; the
// first shows until another is picked.
export function PersonaSummary({ summary, personas, layer }: { summary: Summary; personas: Persona[]; layer: number }) {
  const chosen = useViewStore(state => state.summaryReader);
  const setReader = useViewStore(state => state.setSummaryReader);
  const [status, setStatus] = useState("");
  // A guide rendered before the names were carried has only the ids.
  const shown = (personas.length ? personas : Object.keys(summary).map(id => ({ id, name: id }))).filter(p => summary[p.id]);
  const reader = chosen && summary[chosen] ? chosen : (shown[0]?.id ?? "");
  const text = summary[reader] ?? "";

  // Called from the click, which the clipboard needs; where the browser refuses, the text is there to select.
  const copy = () =>
    navigator.clipboard?.writeText(text).then(
      () => setStatus("Copied"),
      () => setStatus("The browser blocked copying: select the text instead"),
    );

  return (
    <section className="grid gap-3" aria-label="What this PR does">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="font-serif text-xl">What this PR does</h2>
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs" role="status">
            {status}
          </span>
          <Button size="sm" variant="outline" onClick={copy} onBlur={() => setStatus("")}>
            {status === "Copied" ? <Check /> : <Copy />}
            Copy
          </Button>
        </span>
      </div>
      <ButtonGroup aria-label="Written for" className="max-w-full flex-wrap">
        {shown.map(({ id, name }) => (
          <Button
            key={id}
            size="sm"
            variant={id === reader ? "default" : "outline"}
            aria-pressed={id === reader}
            onClick={() => {
              setReader(id);
              setStatus("");
            }}
          >
            {name}
          </Button>
        ))}
      </ButtonGroup>
      <div className="grid max-w-prose gap-2.5 text-[15px] leading-relaxed" aria-live="polite" data-summary-text>
        <Parts parts={summaryParts(text)} layer={layer} reader={reader} />
      </div>
    </section>
  );
}
