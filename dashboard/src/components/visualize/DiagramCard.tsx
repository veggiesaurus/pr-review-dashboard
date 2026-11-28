import { ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Maximize2 } from "lucide-react";
import { Fragment, type KeyboardEvent, useMemo, useState } from "react";

import type { Diagram, Layer } from "shared/payload";
import { LINK, Prose } from "src/components/links/Prose";
import { Badge } from "src/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "src/components/ui/dialog";
import { DiagramView } from "src/components/visualize/Diagram";
import { type Folds, NONE, outermost, parse, type Toggle } from "src/components/visualize/fold";
import { type DiagramTheme, useDiagramTheme } from "src/components/visualize/mermaid";
import { diagramKind, KINDS, type Mark, marksIn } from "src/components/visualize/source";
import { useLayer } from "src/queries/review.query";
import { useViewStore } from "src/store/view.store";
import { diagramElementId } from "src/utils/anchors";
import { cn } from "src/utils/cn";

const pad = (n: number) => String(n).padStart(2, "0");

const LEGEND: Record<Mark, { label: string; swatch: string }> = {
  added: { label: "New", swatch: "bg-diff-add border-success" },
  changed: { label: "Changed", swatch: "bg-accent border-primary" },
  removed: { label: "Removed", swatch: "bg-diff-del border-danger border-dashed" },
};

// Short enough for the three to share a phone's row.
const ICON =
  "grid size-8 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-11";

function Legend({ diagram }: { diagram: Diagram }) {
  if (diagram.allNew) {
    return <Badge tone="success">All new in this PR</Badge>;
  }
  const marks = marksIn(diagram.source);
  if (!marks.length) {
    return null;
  }
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs" aria-label="What this change did, by colour">
      {marks.map(mark => (
        <li key={mark} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-3 rounded-sm border-2", LEGEND[mark].swatch)} />
          {LEGEND[mark].label}
        </li>
      ))}
    </ul>
  );
}

function SectionLinks({ layer, diagram }: { layer: Layer; diagram: Diagram }) {
  const goTo = useViewStore(state => state.goTo);
  const titled = diagram.sections.flatMap(n => {
    const section = layer.sections[n - 1];
    return section?.kind === "guide" ? [{ n, title: section.title }] : [];
  });
  if (!titled.length) {
    return null;
  }
  return (
    <p className="text-muted-foreground text-xs">
      In the guide:{" "}
      {titled.map(({ n, title }, index) => (
        <Fragment key={n}>
          {index > 0 && " · "}
          <button type="button" onClick={() => goTo(layer.id, `s${n}`)} className={cn("cursor-pointer", LINK)}>
            {title}
          </button>
        </Fragment>
      ))}
    </p>
  );
}

function Heading({ index, diagram }: { index: number; diagram: Diagram }) {
  const kind = diagramKind(diagram.source);
  return (
    <>
      <span className="font-mono text-muted-foreground text-xs">{pad(index + 1)}</span>
      <span className="min-w-0 flex-1 font-medium">{diagram.title}</span>
      {kind && <Badge tone="outline">{KINDS[kind]}</Badge>}
    </>
  );
}

function FoldButtons({ source, onFolds }: { source: string; onFolds: (folds: Folds) => void }) {
  const blocks = useMemo(() => (diagramKind(source) === "sequenceDiagram" ? outermost(parse(source)) : []), [source]);
  if (!blocks.length) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        className={ICON}
        aria-label="Fold all"
        title="Fold every block"
        onClick={() => onFolds({ blocks, sections: [] })}
      >
        <ChevronsDownUp className="size-4" />
      </button>
      <button type="button" className={ICON} aria-label="Unfold all" title="Unfold every block" onClick={() => onFolds(NONE)}>
        <ChevronsUpDown className="size-4" />
      </button>
    </>
  );
}

type Shared = {
  layer: Layer;
  diagrams: Diagram[];
  theme: DiagramTheme;
  foldsOf: (index: number) => Folds;
  toggle: (index: number) => Toggle;
  setFolds: (index: number, folds: Folds) => void;
};

function Viewer({
  index,
  onIndex,
  onClose,
  ...shared
}: Shared & { index: number | null; onIndex: (index: number) => void; onClose: () => void }) {
  const { layer, diagrams, theme, foldsOf, toggle, setFolds } = shared;
  const diagram = index === null ? undefined : diagrams[index];
  const many = diagrams.length > 1;
  const step = (by: number) => index !== null && onIndex((index + by + diagrams.length) % diagrams.length);
  const onKeyDown = (event: KeyboardEvent) => {
    if (many && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    }
  };
  return (
    <Dialog open={diagram !== undefined} onOpenChange={open => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        onKeyDown={onKeyDown}
        data-viewer
        className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden bg-card p-0"
      >
        {diagram && index !== null && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b py-2 pr-12 pl-4">
              <DialogTitle className="flex min-w-[min(100%,18rem)] flex-1 items-baseline gap-2 pr-0 font-sans text-base">
                <Heading index={index} diagram={diagram} />
              </DialogTitle>
              {/* Fold on the left and the diagram switcher on the right, each icon lined up with the title and the close. */}
              <div className="-ml-2 -mr-10 pointer-coarse:-mr-11.5 pointer-coarse:-ml-3.5 flex grow basis-full items-center">
                <FoldButtons source={diagram.source} onFolds={next => setFolds(index, next)} />
                {many && (
                  <div className="ml-auto flex items-center">
                    <span className="px-1 font-mono text-muted-foreground text-xs" data-count>
                      {index + 1} / {diagrams.length}
                    </span>
                    <button
                      type="button"
                      className={ICON}
                      aria-label="Previous diagram"
                      title="Previous diagram (←)"
                      onClick={() => step(-1)}
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <button type="button" className={ICON} aria-label="Next diagram" title="Next diagram (→)" onClick={() => step(1)}>
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div key={index} className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
              {diagram.why && (
                <p className="text-muted-foreground text-sm">
                  <Prose text={diagram.why} layer={layer.id} />
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionLinks layer={layer} diagram={diagram} />
                <Legend diagram={diagram} />
              </div>
              <div className="pt-2">
                <DiagramView source={diagram.source} theme={theme} folds={foldsOf(index)} onToggle={toggle(index)} fit="width" />
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// One diagram as a card of its own, folding in place; its full-screen viewer steps through the layer's other diagrams.
export function DiagramCard({ layer, index }: { layer: number; index: number }) {
  const shown = useLayer(layer);
  const theme = useDiagramTheme();
  const [folds, setFoldsState] = useState<Record<number, Folds>>({});
  const [viewing, setViewing] = useState<number | null>(null);
  const diagram = shown?.diagrams[index];
  if (!shown || !diagram) {
    return null;
  }

  const shared: Shared = {
    layer: shown,
    diagrams: shown.diagrams,
    theme,
    foldsOf: at => folds[at] ?? NONE,
    toggle: at => (kind, ordinal) =>
      setFoldsState(all => {
        const was = all[at] ?? NONE;
        const list = was[kind];
        return { ...all, [at]: { ...was, [kind]: list.includes(ordinal) ? list.filter(o => o !== ordinal) : [...list, ordinal] } };
      }),
    setFolds: (at, next) => setFoldsState(all => ({ ...all, [at]: next })),
  };

  return (
    <article
      id={diagramElementId(layer, index)}
      data-diagram={index}
      className="flex min-w-0 scroll-mt-16 flex-col gap-3 rounded-lg border bg-card p-4"
    >
      <h3 className="flex items-baseline gap-2">
        <Heading index={index} diagram={diagram} />
      </h3>
      <div className="flex flex-wrap items-center">
        <FoldButtons source={diagram.source} onFolds={next => shared.setFolds(index, next)} />
        <button
          type="button"
          className={ICON}
          aria-label={`Open ${diagram.title} full screen`}
          title="Full screen"
          onClick={() => setViewing(index)}
        >
          <Maximize2 className="size-4" />
        </button>
        <div className="ml-auto">
          <Legend diagram={diagram} />
        </div>
      </div>
      {diagram.why && (
        <p className="text-muted-foreground text-sm">
          <Prose text={diagram.why} layer={layer} />
        </p>
      )}
      <SectionLinks layer={shown} diagram={diagram} />
      <div className="pt-2">
        <DiagramView source={diagram.source} theme={theme} folds={shared.foldsOf(index)} onToggle={shared.toggle(index)} fit="card" />
      </div>
      <Viewer {...shared} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
    </article>
  );
}
