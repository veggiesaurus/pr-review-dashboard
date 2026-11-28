import { useMemo } from "react";
import type { PresenceEntry } from "shared/messages";
import type { Section } from "shared/payload";

import { pad2, shownSections } from "src/components/guide/visible";
import { Avatars } from "src/components/presence/Avatars";
import { usePresenceList } from "src/queries/presence.query";
import { useLayer } from "src/queries/review.query";
import { sectionTickKeys, useTickedCount } from "src/store/ticks.store";
import { useViewStore } from "src/store/view.store";
import { cn } from "src/utils/cn";

function Pill({ layer, index, section, readers }: { layer: number; index: number; section: Section; readers: PresenceEntry[] }) {
  const shown = useLayer(layer);
  const goTo = useViewStore(state => state.goTo);
  const keys = shown ? sectionTickKeys(shown, index) : [];
  const done = useTickedCount(keys) === keys.length && keys.length > 0;
  const guide = section.kind === "guide";
  const risky = guide && Boolean(section.risk);
  return (
    <li className="inline-flex items-center gap-1">
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
      {readers.length > 0 && <Avatars people={readers} size="sm" />}
    </li>
  );
}

// The template's index under the header: one pill per shown section, ticked when reviewed, ! when it needs a careful read.
export function SectionIndex({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const show = useViewStore(state => state.show);
  const formatting = useViewStore(state => state.formatting);
  // In the page's order, so a pill's number matches where it leads; the ! marks the ones that need a careful read.
  const sections = useMemo(() => (shown ? shownSections(shown, show, formatting) : []), [shown, show, formatting]);
  const readers = usePresenceList().filter(entry => entry.layer === layer && entry.tab === "guide");
  if (!sections.length) {
    return null;
  }
  return (
    <ul aria-label="Sections" className="flex flex-wrap gap-1.5">
      {sections.map(({ index, section }) => (
        <Pill key={index} layer={layer} index={index} section={section} readers={readers.filter(entry => entry.section === index)} />
      ))}
    </ul>
  );
}
