import { FlaskConical } from "lucide-react";
import { useMemo } from "react";
import type { Diagram } from "shared/payload";

import { AskClaude } from "src/components/chat/AskClaude";
import { FileCard } from "src/components/diff/FileCard";
import { useWide } from "src/components/diff/hooks";
import { FileItem } from "src/components/guide/FileItem";
import { ReviewedTick } from "src/components/guide/ReviewedTick";
import { pad2, type ShownSection, shownSections } from "src/components/guide/visible";
import { Prose } from "src/components/links/Prose";
import { TriedAnswer } from "src/components/ready/Tried";
import { stepEvidence, stepsFor } from "src/components/ready/tries";
import { DiagramCard } from "src/components/visualize/DiagramCard";
import { useMessages } from "src/queries/messages.query";
import { useLayer } from "src/queries/review.query";
import { useOthersTicks } from "src/queries/ticks.query";
import { namesOf, reviewedBy, sectionTickKeys, tickKey } from "src/store/ticks.store";
import { useViewStore } from "src/store/view.store";
import { sectionElementId } from "src/utils/anchors";
import { indexLayer } from "src/utils/payload";

// The template's words for the two closing sections, which have none of their own.
const CLOSING = {
  formatting: {
    why: "These hunks only change layout, the quotes or punctuation a formatter settles, or the order of imports, so they are kept out of the sections above.",
    how: "Each one is shown dimmed. A hunk that also has real changes stays in its section, with just its formatting lines dimmed.",
  },
  generated: {
    why: "Lock files and generated code change as a side effect of the other changes.",
    how: "They are collapsed; open one with Show diff if the regeneration itself needs checking.",
  },
};

// What a section says about itself: who has reviewed it, the careful read, what to try by hand, why and how, and its
// files. On a wide window it sits in the outline beside the code; on a narrow one, above the section's cards.
export function SectionText({ layer, shown, count }: { layer: number; shown: ShownSection; count: number }) {
  const review = useLayer(layer);
  const others = useOthersTicks();
  const { data: messages = [] } = useMessages();
  const { index, section, parts } = shown;
  if (!review) {
    return null;
  }
  // The things to try that exercise this section's code, so what Claude found when it tried them sits beside that code.
  const steps = stepsFor(review.try ?? [], section.files).map(at => ({
    at,
    step: review.try[at] ?? "",
    ...stepEvidence(messages, layer, at),
  }));
  const reviewers = reviewedBy(others, sectionTickKeys(review, index));
  const files = indexLayer(review).files;
  const text = section.kind === "guide" ? section : { ...CLOSING[section.kind], risk: "" };
  return (
    <div className="grid min-w-0 content-start gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-sm">
        {section.kind === "guide" && (
          <span className="font-mono text-xs">
            {pad2(index + 1)} / {pad2(count)}
          </span>
        )}
        <ReviewedTick layer={layer} section={index} />
        <AskClaude anchor={{ kind: "section", layer, index }} label="Ask Claude" />
        {reviewers.length > 0 && (
          <span className="basis-full">
            {namesOf(reviewers)} {reviewers.length === 1 ? "has" : "have"} reviewed this
          </span>
        )}
      </div>
      {text.risk && (
        <p className="rounded-md border-warning border-l-2 bg-warning/10 px-3 py-2 text-sm">
          <span className="font-medium">Careful read: </span>
          {text.risk}
        </p>
      )}
      {steps.map(({ step, at, answer }) => (
        <div key={at} data-step={at} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-md border px-3 py-2 text-sm">
          <FlaskConical aria-hidden className="mt-0.5 size-4 text-muted-foreground" />
          <div className="min-w-0">
            <p>
              <span className="font-medium">Try by hand: </span>
              <Prose text={step} layer={layer} section={index} />
            </p>
            {/* Folded here whatever it found: the column is narrow, and the Overview is where it opens by itself. */}
            {answer && <TriedAnswer answer={answer} layer={layer} head={review.meta.headSha} />}
          </div>
        </div>
      ))}
      <p className="text-base leading-relaxed">
        <Prose text={text.why} layer={layer} section={index} />
      </p>
      <p className="text-foreground/75 text-sm leading-relaxed">
        <Prose text={text.how} layer={layer} section={index} />
      </p>
      <ul className="grid gap-1.5" aria-label="Files in this section">
        {parts.map(part => {
          const file = files.get(part.id);
          return (
            file && (
              <FileItem
                key={part.id}
                layer={layer}
                file={file}
                hunkIds={part.hunks}
                section={index}
                keys={[tickKey(review, part.id, part.hunks)]}
              />
            )
          );
        })}
      </ul>
    </div>
  );
}

// A section in the code column: a heading to mark where it starts, the diagrams that begin here, then its cards.
function SectionView({ layer, shown, count, diagrams }: { layer: number; shown: ShownSection; count: number; diagrams: number[] }) {
  const wide = useWide();
  const { index, section, parts } = shown;
  return (
    <section id={sectionElementId(layer, index)} data-section={index} className="grid scroll-mt-16 gap-4 border-b py-6 first:pt-2">
      <h2 className="flex items-baseline gap-3 text-balance font-serif text-xl leading-tight tracking-tight">
        <span className="font-mono text-muted-foreground text-xs">{section.kind === "guide" ? pad2(index + 1) : "·"}</span>
        {section.title}
      </h2>
      {!wide && <SectionText layer={layer} shown={shown} count={count} />}
      {diagrams.map(at => (
        <DiagramCard key={at} layer={layer} index={at} />
      ))}
      {parts.map(part => (
        <FileCard key={part.id} layer={layer} file={part.id} hunkIds={part.hunks} section={index} />
      ))}
    </section>
  );
}

// Where each diagram is drawn: above the first shown section it covers, or before them all when it names none shown.
export function diagramHomes(diagrams: Diagram[], shown: ShownSection[]) {
  const homes = new Map<number | "top", number[]>();
  diagrams.forEach((diagram, at) => {
    const home = diagram.sections.map(n => n - 1).find(index => shown.some(s => s.index === index)) ?? "top";
    homes.set(home, [...(homes.get(home) ?? []), at]);
  });
  return homes;
}

// The Guide tab: the sections render.py built, each with its cards. Formatting stays hidden unless asked for, and a
// filter hides the cards and sections it doesn't touch.
export function Guide({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const show = useViewStore(state => state.show);
  const formatting = useViewStore(state => state.formatting);
  const sections = useMemo(() => (shown ? shownSections(shown, show, formatting) : []), [shown, show, formatting]);
  const homes = useMemo(() => diagramHomes(shown?.diagrams ?? [], sections), [shown, sections]);
  if (!shown?.sections.length) {
    return null;
  }
  const count = shown.sections.filter(section => section.kind === "guide").length;
  return (
    <div>
      {sections.length === 0 && <p className="py-6 text-muted-foreground text-sm">Nothing in the guide is in this part of the change.</p>}
      {(homes.get("top") ?? []).map(at => (
        <div key={at} className="pt-2 pb-4">
          <DiagramCard layer={layer} index={at} />
        </div>
      ))}
      {sections.map(section => (
        <SectionView key={section.index} layer={layer} shown={section} count={count} diagrams={homes.get(section.index) ?? []} />
      ))}
    </div>
  );
}
