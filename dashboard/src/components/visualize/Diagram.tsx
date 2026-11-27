import { useEffect, useMemo, useRef, useState } from "react";

import { decorate, type Folds, foldedSource, parse, type Toggle } from "src/components/visualize/fold";
import { type DiagramTheme, renderDiagram } from "src/components/visualize/mermaid";
import { diagramKind, prepare } from "src/components/visualize/source";
import "src/components/visualize/visualize.css";

// screen: the whole drawing in the window as the page is laid out, from where it starts down to the bottom bar, never
// enlarged. width: across its column, up to twice its natural size, for the full-screen viewer to scroll.
type Fit = "screen" | "width";
const BOTTOM_BAR = 96;
const LEAST_ROOM = 320;

const viewBox = (svg: SVGSVGElement) => (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);

// Everything the page lays out under the diagram, its bottom padding clear of the bottom bar included, or it scrolls.
function below(host: HTMLElement, box: DOMRect) {
  const page = host.closest("main");
  return page ? page.getBoundingClientRect().bottom - box.bottom : BOTTOM_BAR;
}

export function DiagramView({
  source,
  theme,
  folds,
  onToggle,
  fit,
}: {
  source: string;
  theme: DiagramTheme;
  folds: Folds;
  onToggle?: Toggle;
  fit: Fit;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const model = useMemo(() => (diagramKind(source) === "sequenceDiagram" ? parse(source) : null), [source]);
  const [error, setError] = useState<string | null>(null);
  const toggle = useRef(onToggle);
  toggle.current = onToggle;
  const interactive = Boolean(onToggle);
  // The drawing's height with nothing folded, so folding a block shortens it without zooming the rest in.
  const unfolded = useRef(0);

  const size = () => {
    const root = host.current?.querySelector("svg");
    const [, , width = 0, height = 0] = root ? viewBox(root) : [];
    if (!root || !host.current || !width || !height) {
      return;
    }
    const box = host.current.getBoundingClientRect();
    const across = host.current.clientWidth / width;
    const scale =
      fit === "width"
        ? Math.min(2, across)
        : Math.min(
            1,
            across,
            Math.max(LEAST_ROOM, window.innerHeight - (box.top + window.scrollY) - below(host.current, box)) /
              Math.max(height, unfolded.current),
          );
    root.style.maxWidth = "none";
    root.style.width = `${Math.floor(width * scale)}px`;
    root.style.height = `${Math.floor(height * scale)}px`;
  };
  const resize = useRef(size);
  resize.current = size;

  useEffect(() => {
    const again = () => resize.current();
    const watch = new ResizeObserver(again);
    if (host.current) {
      watch.observe(host.current);
    }
    window.addEventListener("resize", again);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", again);
    };
  }, []);

  useEffect(() => {
    let stale = false;
    const text = prepare(model ? foldedSource(model, folds) : source, theme.marks);
    renderDiagram(text, theme).then(
      svg => {
        if (stale || !host.current) {
          return;
        }
        // Mermaid's own output, which its strict security level has already sanitised.
        host.current.innerHTML = svg;
        const root = host.current.querySelector("svg");
        if (root && model) {
          decorate(root, model, folds, interactive ? (kind, ordinal) => toggle.current?.(kind, ordinal) : undefined);
        }
        if (root && !folds.blocks.length && !folds.sections.length) {
          unfolded.current = viewBox(root)[3] ?? 0;
        }
        resize.current();
        setError(null);
      },
      (failure: unknown) => {
        if (!stale) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      },
    );
    return () => {
      stale = true;
    };
  }, [source, model, folds, theme, interactive]);

  return (
    <>
      <span ref={host} className="prg-diagram block" hidden={Boolean(error)} />
      {error && (
        <span className="block text-left text-sm" role="alert">
          <span className="block text-danger">Mermaid couldn't draw this diagram: {error}</span>
          <span className="mt-2 block whitespace-pre-wrap font-mono text-muted-foreground text-xs">{source}</span>
        </span>
      )}
    </>
  );
}
