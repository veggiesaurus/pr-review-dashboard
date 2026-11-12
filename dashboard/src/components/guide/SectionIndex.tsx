import { useMemo } from "react";
import type { Section } from "shared/payload";

import { pad2, shownSections } from "src/components/guide/visible";
import { useLayer } from "src/queries/review.query";
import { sectionTickKeys, useTickedCount } from "src/store/ticks.store";
import { useViewStore } from "src/store/view.store";
import { cn } from "src/utils/cn";

function Pill({ layer, index, section }: { layer: number; index: number; section: Section }) {
  const shown = useLayer(layer);
  const goTo = useViewStore(state => state.goTo);
  const keys = shown ? sectionTickKeys(shown, index) : [];
  const done = useTickedCount(keys) === keys.length && keys.length > 0;
  const guide = section.kind === "guide";
  const risky = guide && Boolean(section.risk);
  return (
    <li>
      <button
        type="button"
        onClick={() => goTo(layer, `s${index + 1}`)}
        title={risky ? `Careful read: ${section.kind === "guide" ? section.risk : ""}` : undefined}
        className={cn(
          "inline-flex cursor-pointer items-baseline gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-left text-[13px] hover:border-ring",
          !guide && "border-dashed bg-transparent text-muted-foreground",
          done && "text-muted-foreground",
        )}
      >
        <span className="whitespace-nowrap font-mono text-[11.5px] text-muted-foreground">
          {risky && <span className="font-bold text-warning">! </span>}
          {guide ? pad2(index + 1) : "·"}
          {done && <span className="text-success"> ✓</span>}
        </span>
        {section.title}
      </button>
    </li>
  );
}

// The template's index under the header: one pill per shown section, ticked when reviewed, ! when it needs a careful read.
export function SectionIndex({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const show = useViewStore(state => state.show);
  const formatting = useViewStore(state => state.formatting);
  // The ones that need a careful read come first, since what is listed last gets the least attention.
  const sections = useMemo(() => {
    const risky = ({ section }: { section: Section }) => (section.kind === "guide" && section.risk ? 0 : 1);
    return (shown ? shownSections(shown, show, formatting) : []).toSorted((a, b) => risky(a) - risky(b));
  }, [shown, show, formatting]);
  if (!sections.length) {
    return null;
  }
  return (
    <ul aria-label="Sections" className="flex flex-wrap gap-1.5">
      {sections.map(({ index, section }) => (
        <Pill key={index} layer={layer} index={index} section={section} />
      ))}
    </ul>
  );
}
