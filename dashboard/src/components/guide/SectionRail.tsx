import { useEffect, useMemo, useState } from "react";
import type { Section } from "shared/payload";

import { currentSection, land, sectionElements } from "src/components/guide/nav";
import { pad2, type ShownSection, shownSections } from "src/components/guide/visible";
import { Tooltip, TooltipContent, TooltipTrigger } from "src/components/ui/tooltip";
import { useLayer } from "src/queries/review.query";
import { sectionTickKeys, useTickedCount } from "src/store/ticks.store";
import { useViewStore } from "src/store/view.store";
import { sectionElementId } from "src/utils/anchors";
import { cn } from "src/utils/cn";

// The section being read, by data-section index, updated as the page scrolls.
function useCurrentSection(sections: ShownSection[]) {
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    if (!sections.length) {
      setAt(null);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const element = currentSection(sectionElements());
      setAt(element ? Number(element.dataset.section) : null);
    };
    const later = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", later);
      window.removeEventListener("resize", later);
    };
  }, [sections]);
  return at;
}

function Mark({ layer, index, section, here }: { layer: number; index: number; section: Section; here: boolean }) {
  const shown = useLayer(layer);
  const keys = shown ? sectionTickKeys(shown, index) : [];
  const done = useTickedCount(keys) === keys.length && keys.length > 0;
  const number = section.kind === "guide" ? pad2(index + 1) : "·";
  const jump = () => {
    const element = document.getElementById(sectionElementId(layer, index));
    if (element) {
      land(element, false);
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={jump}
          aria-label={`${number} ${section.title}${done ? ", reviewed" : ""}`}
          aria-current={here ? "location" : undefined}
          className="group/mark flex h-3 w-6 cursor-pointer items-center"
        >
          <span
            className={cn(
              "h-0.5 rounded-full transition-[width,background-color] duration-150",
              here ? "w-6 bg-primary" : "w-3 group-hover/mark:w-5",
              !here && (done ? "bg-success" : section.kind === "guide" ? "bg-foreground/35" : "bg-foreground/20"),
            )}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        <span className="font-mono opacity-70">{number}</span> {section.title}
        {done && " ✓"}
      </TooltipContent>
    </Tooltip>
  );
}

// A thin rail at the left edge of a wide window, one mark per shown section, like Linear's: the one being read is
// long, reviewed ones are green, and the title shows on hover.
export function SectionRail({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const show = useViewStore(state => state.show);
  const formatting = useViewStore(state => state.formatting);
  const sections = useMemo(() => (shown ? shownSections(shown, show, formatting) : []), [shown, show, formatting]);
  const here = useCurrentSection(sections);
  if (sections.length < 2) {
    return null;
  }
  return (
    <nav
      aria-label="Sections"
      className="fixed top-1/2 left-3 z-10 hidden max-h-[80vh] -translate-y-1/2 flex-col gap-1 overflow-y-auto py-2 min-[80rem]:flex"
    >
      {sections.map(({ index, section }) => (
        <Mark key={index} layer={layer} index={index} section={section} here={here === index} />
      ))}
    </nav>
  );
}
