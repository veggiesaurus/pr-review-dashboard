import { useMemo } from "react";

import { AskClaude } from "src/components/chat/AskClaude";
import { FileCard } from "src/components/diff/FileCard";
import { FileItem } from "src/components/guide/FileItem";
import { ReviewedTick } from "src/components/guide/ReviewedTick";
import { pad2, type ShownSection, shownSections } from "src/components/guide/visible";
import { Prose } from "src/components/links/Prose";
import { useLayer } from "src/queries/review.query";
import { tickKey } from "src/store/ticks.store";
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

// The side column stays in view beside its cards on a wide window, as the template's does; one column below 860px.
// The text column gets a little wider once the window has room for it and two panes of code.
export const SPLIT_COLUMNS =
  "grid gap-x-6 gap-y-4 min-[861px]:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] min-[100rem]:grid-cols-[24rem_minmax(0,1fr)]";
export const SIDE =
  "grid min-w-0 content-start gap-3 self-start min-[861px]:sticky min-[861px]:top-4 min-[861px]:max-h-[calc(100vh-6rem)] min-[861px]:overflow-y-auto";

function SectionView({ layer, shown, count }: { layer: number; shown: ShownSection; count: number }) {
  const review = useLayer(layer);
  const { index, section, parts } = shown;
  if (!review) {
    return null;
  }
  const files = indexLayer(review).files;
  const text = section.kind === "guide" ? section : { ...CLOSING[section.kind], risk: "" };
  return (
    <section id={sectionElementId(layer, index)} data-section={index} className={`${SPLIT_COLUMNS} scroll-mt-4 border-b py-6`}>
      <aside className={SIDE}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
          {section.kind === "guide" && (
            <span className="font-mono text-xs">
              {pad2(index + 1)} / {pad2(count)}
            </span>
          )}
          <ReviewedTick layer={layer} section={index} />
          <AskClaude anchor={{ kind: "section", layer, index }} label="Ask Claude" />
        </div>
        <h2 className="text-balance font-serif text-2xl leading-tight tracking-tight">{section.title}</h2>
        {text.risk && (
          <p className="rounded-md border-warning border-l-2 bg-warning/10 px-3 py-2 text-[13.5px]">
            <span className="font-medium">Careful read: </span>
            {text.risk}
          </p>
        )}
        <p className="text-[15px] leading-relaxed">
          <Prose text={text.why} layer={layer} section={index} />
        </p>
        <p className="text-[14px] text-foreground/75 leading-relaxed">
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
      </aside>
      <div className="grid min-w-0 content-start gap-4">
        {parts.map(part => (
          <FileCard key={part.id} layer={layer} file={part.id} hunkIds={part.hunks} section={index} />
        ))}
      </div>
    </section>
  );
}

// The Guide tab: the sections render.py built, each with its cards. Formatting stays hidden unless asked for, and a
// filter hides the cards and sections it doesn't touch.
export function Guide({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const show = useViewStore(state => state.show);
  const formatting = useViewStore(state => state.formatting);
  const sections = useMemo(() => (shown ? shownSections(shown, show, formatting) : []), [shown, show, formatting]);
  if (!shown?.sections.length) {
    return null;
  }
  const count = shown.sections.filter(section => section.kind === "guide").length;
  return (
    <div className="mt-2">
      {sections.length === 0 && <p className="py-6 text-muted-foreground text-sm">Nothing in the guide is in this part of the change.</p>}
      {sections.map(section => (
        <SectionView key={section.index} layer={layer} shown={section} count={count} />
      ))}
    </div>
  );
}
