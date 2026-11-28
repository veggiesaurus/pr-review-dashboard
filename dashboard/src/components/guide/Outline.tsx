import { useMemo } from "react";

import { FileList } from "src/components/guide/DiffTab";
import { SectionText } from "src/components/guide/Guide";
import { pad2, type ShownSection, shownSections } from "src/components/guide/visible";
import { Avatars } from "src/components/presence/Avatars";
import { Segmented } from "src/components/ui/segmented";
import { usePresenceList } from "src/queries/presence.query";
import { useLayer } from "src/queries/review.query";
import { sectionTickKeys, useTickedCount } from "src/store/ticks.store";
import { useViewStore } from "src/store/view.store";
import { diagramElementId } from "src/utils/anchors";
import { cn } from "src/utils/cn";

function Row({ layer, shown, count, here }: { layer: number; shown: ShownSection; count: number; here: boolean }) {
  const review = useLayer(layer);
  const goTo = useViewStore(state => state.goTo);
  const readers = usePresenceList().filter(entry => entry.layer === layer && entry.tab === "guide" && entry.section === shown.index);
  const keys = review ? sectionTickKeys(review, shown.index) : [];
  const done = useTickedCount(keys) === keys.length && keys.length > 0;
  const { index, section } = shown;
  const guide = section.kind === "guide";
  const risky = guide && Boolean(section.risk);
  return (
    <li className={cn("rounded-md", here && "bg-card shadow-xs ring-1 ring-border")}>
      <button
        type="button"
        onClick={() => goTo(layer, `s${index + 1}`)}
        aria-current={here || undefined}
        aria-label={`${guide ? pad2(index + 1) : ""} ${section.title}${risky ? ", careful read" : ""}${done ? ", reviewed" : ""}`}
        className={cn(
          "flex w-full cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted pointer-coarse:min-h-11",
          here && "font-medium hover:bg-transparent",
          done && !here && "text-muted-foreground",
        )}
      >
        <span className="w-5 shrink-0 font-mono text-muted-foreground text-xs">
          {done ? <span className="text-success">✓</span> : guide ? pad2(index + 1) : "·"}
        </span>
        <span className={cn("min-w-0 flex-1", !here && "truncate")}>
          {section.title}
          {risky && <span className="ml-1.5 font-bold text-warning">!</span>}
        </span>
        {readers.length > 0 && <Avatars people={readers} size="sm" />}
      </button>
      {here && (
        <div className="motion-grow px-2 pt-1 pb-3">
          <SectionText layer={layer} shown={shown} count={count} />
        </div>
      )}
    </li>
  );
}

// The left of the Changes view on a wide window: by section, every section with the one in view opened to its
// explanation and files; by file, the file list.
export function Outline({ layer, current }: { layer: number; current: number | null }) {
  const shown = useLayer(layer);
  const tab = useViewStore(state => state.tab);
  const setTab = useViewStore(state => state.setTab);
  const show = useViewStore(state => state.show);
  const formatting = useViewStore(state => state.formatting);
  const sections = useMemo(() => (shown ? shownSections(shown, show, formatting) : []), [shown, show, formatting]);
  if (!shown) {
    return null;
  }
  const count = shown.sections.filter(section => section.kind === "guide").length;
  // Before the first section is reached, the first is the one to read.
  const here = current ?? sections[0]?.index ?? null;
  return (
    <nav
      aria-label="Outline"
      className="sticky top-12 grid h-[calc(100dvh-3rem)] grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-y-auto overscroll-contain border-r bg-muted/40 px-3 py-4"
    >
      {shown.sections.length > 0 && (
        <Segmented
          label="Show the changes"
          value={tab === "diff" ? "diff" : "guide"}
          onChange={setTab}
          className="justify-self-start"
          segments={[
            { value: "guide", label: "Sections", title: "By section (2)" },
            { value: "diff", label: "Files", title: "By file (3)" },
          ]}
        />
      )}
      {tab === "diff" || !shown.sections.length ? (
        <FileList layer={layer} />
      ) : (
        <>
          <ol aria-label="Sections" className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
            {sections.map(section => (
              <Row key={section.index} layer={layer} shown={section} count={count} here={section.index === here} />
            ))}
          </ol>
          {shown.diagrams.length > 0 && (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5 border-t pt-3">
              <h3 className="px-2 text-muted-foreground text-xs">Diagrams</h3>
              {shown.diagrams.map((diagram, at) => (
                <button
                  key={diagram.title}
                  type="button"
                  onClick={() => document.getElementById(diagramElementId(layer, at))?.scrollIntoView({ block: "start" })}
                  className="cursor-pointer truncate rounded-md px-2 py-1 text-left text-sm hover:bg-muted pointer-coarse:min-h-11"
                >
                  {diagram.title}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </nav>
  );
}
