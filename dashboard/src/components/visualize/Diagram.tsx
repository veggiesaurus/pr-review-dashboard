import { useEffect, useMemo, useRef, useState } from "react";

import { decorate, type Folds, foldedSource, parse, type Toggle } from "src/components/visualize/fold";
import { type DiagramTheme, renderDiagram } from "src/components/visualize/mermaid";
import { diagramKind, prepare } from "src/components/visualize/source";
import "src/components/visualize/visualize.css";

// card: across its card, but never shrinking the labels under MIN_LABEL pixels (its box scrolls sideways instead) nor
// enlarging past 1.5x. width: across its column, up to twice its natural size, for the full-screen viewer to scroll.
type Fit = "card" | "width";
const MIN_LABEL = 11;
// And no larger than the page's body text, however much room the card has.
const MAX_LABEL = 14;

const viewBox = (svg: SVGSVGElement) => (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);

// The drawing's typical label size in its own units, from the styles mermaid gave it.
function labelSize(svg: SVGSVGElement) {
  const sizes = [...svg.querySelectorAll("text, foreignObject span")]
    .map(label => Number.parseFloat(getComputedStyle(label).fontSize))
    .filter(size => size > 0)
    .sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)] ?? 14;
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
  const label = useRef(14);

  const size = () => {
    const root = host.current?.querySelector("svg");
    const [, , width = 0, height = 0] = root ? viewBox(root) : [];
    if (!root || !host.current || !width || !height) {
      return;
    }
    const across = host.current.clientWidth / width;
    const scale =
      fit === "width" ? Math.min(2, across) : Math.min(1.5, MAX_LABEL / label.current, Math.max(across, MIN_LABEL / label.current));
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
        if (root) {
          label.current = labelSize(root);
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
      <span ref={host} className="prg-diagram block overflow-x-auto" hidden={Boolean(error)} />
      {error && (
        <span className="block text-left text-sm" role="alert">
          <span className="block text-danger">Mermaid couldn't draw this diagram: {error}</span>
          <span className="mt-2 block whitespace-pre-wrap font-mono text-muted-foreground text-xs">{source}</span>
        </span>
      )}
    </>
  );
}
