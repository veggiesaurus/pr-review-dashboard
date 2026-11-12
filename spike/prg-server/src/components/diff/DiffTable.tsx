import { Fragment, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import type { LocalEdit } from "shared/local";
import type { LineAnchor } from "shared/messages";
import type { Hunk, Layer, ReviewFile, Tell } from "shared/payload";
import { openComposer, useChatStore } from "src/components/chat/chat.store";
import { type Thread, useAnchoredThreads } from "src/components/chat/useThreads";
import { CrossLayerRow, useCrossLinks } from "src/components/diff/CrossLayer";
import { DiffContext, type DiffContextValue } from "src/components/diff/context";
import { GapBody, type GapSelection, type HeadMarks } from "src/components/diff/GapBody";
import type { LineSelection } from "src/components/diff/HunkBody";
import { HunkBody } from "src/components/diff/HunkBody";
import { useWide } from "src/components/diff/hooks";
import { identifierAt, lineOf, rangeFromSelection } from "src/components/diff/pointer";
import { RevertDialog } from "src/components/diff/RevertDialog";
import { UsagesPopover, type UsageTarget } from "src/components/diff/UsagesPopover";
import { useLocalChanges } from "src/queries/local.query";
import { useViewStore } from "src/store/view.store";
import { cn } from "src/utils/cn";
import { cardGaps, languageOf, showsHunk } from "src/utils/diff";
import { indexLayer } from "src/utils/payload";

type Drag = { hunk: string; side: "L" | "R"; start: number; end: number };

const NO_THREADS = new Map<string, Thread[]>();

const rangeAnchor = (layer: number, file: string, hunk: string, side: "L" | "R", a: number, b: number): LineAnchor => ({
  kind: "line",
  layer,
  file,
  hunk,
  side,
  line: Math.min(a, b),
  ...(a === b ? {} : { endLine: Math.max(a, b) }),
});

function clearIdentifier() {
  CSS.highlights?.delete("prg-ident");
  for (const cell of document.querySelectorAll("[data-hot]")) {
    delete (cell as HTMLElement).dataset.hot;
  }
}

const NO_EDITS: LocalEdit[] = [];
const NO_PREVIEWS: ReadonlySet<number> = new Set();

// One file's hunks as a table, with the gaps between them, in either layout.
const NONE_CHANGED: ReadonlySet<string> = new Set();

type DiffTableProps = {
  layer: Layer;
  file: ReviewFile;
  hunks: Hunk[];
  section?: number;
  // Hunks new since the card was ticked: they are marked, and the ones already reviewed dimmed.
  changed?: ReadonlySet<string>;
};

export function DiffTable({ layer, file, hunks, section, changed = NONE_CHANGED }: DiffTableProps) {
  const layout = useViewStore(state => state.layout);
  const formatting = useViewStore(state => state.formatting);
  const show = useViewStore(state => state.show);
  const wide = useWide();
  const split = layout === "split" && wide;
  const threads = useAnchoredThreads(layer.id, file.id);
  const composer = useChatStore(state => state.composer);
  const edits = useLocalChanges(layer.id).data?.files[file.id];
  // The places being previewed, by the head line each edit comes after.
  const [previewing, setPreviewing] = useState<ReadonlySet<number>>(NO_PREVIEWS);
  const [reverting, setReverting] = useState<LocalEdit | null>(null);
  const local = useMemo<DiffContextValue["local"]>(() => {
    const marks = new Map<number, LocalEdit>();
    const shown = new Map<string, LocalEdit[]>();
    const hidden = new Set<number>();
    for (const edit of edits ?? NO_EDITS) {
      marks.set(edit.gone.length ? edit.after + 1 : Math.max(1, edit.after), edit);
      if (previewing.has(edit.after)) {
        // Drawn under the last line it stands in for, which is hidden with the rest, or under the line it follows.
        const at = `R${Math.max(1, edit.after + edit.gone.length)}`;
        shown.set(at, [...(shown.get(at) ?? []), edit]);
        edit.gone.forEach((_, i) => {
          hidden.add(edit.after + 1 + i);
        });
      }
    }
    const toggle = (edit: LocalEdit) =>
      setPreviewing(now => {
        const next = new Set(now);
        if (!next.delete(edit.after)) {
          next.add(edit.after);
        }
        return next;
      });
    return { marks, shown, hidden, toggle, revert: setReverting };
  }, [edits, previewing]);
  // Edits on head lines no hunk shows are named above the table; opening the unchanged lines there shows their button.
  const elsewhere = useMemo(() => {
    const visible = new Set(hunks.flatMap(hunk => hunk.lines.map(row => row[2])));
    return [...local.marks.keys()].filter(line => !visible.has(line));
  }, [local, hunks]);
  const crossLinks = useCrossLinks(layer.id);
  const wrap = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pick, setPick] = useState<{ anchor: LineAnchor; top: number; left: number } | null>(null);
  const [usage, setUsage] = useState<UsageTarget | null>(null);
  const hot = useRef<{ word: string; range: Range } | null>(null);
  const frame = useRef(0);

  const context = useMemo<DiffContextValue>(() => {
    const tells = new Map<string, Tell[]>();
    for (const tell of layer.tells) {
      if (tell.file === file.id) {
        tells.set(tell.line, [...(tells.get(tell.line) ?? []), tell]);
      }
    }
    const annotations: DiffContextValue["annotations"] = new Map();
    layer.annotations.forEach((annotation, index) => {
      if (annotation.file === file.id && annotation.row) {
        annotations.set(annotation.row, [...(annotations.get(annotation.row) ?? []), { annotation, index }]);
      }
    });
    return { layer, file, split, cols: split ? 6 : 3, language: languageOf(file.path), formatting, section, tells, annotations, local };
  }, [layer, file, split, formatting, section, local]);

  const gaps = useMemo(() => {
    const index = indexLayer(layer);
    const where = (id: string) => {
      const at = index.owner.get(id);
      return at === undefined || section === undefined || (layer.sections[at]?.kind === "formatting" && !formatting) ? null : at;
    };
    return cardGaps(file, hunks, where, section);
  }, [layer, file, hunks, section, formatting]);

  const byHunk = useMemo(() => {
    const out = new Map<string, Map<string, Thread[]>>();
    for (const [key, list] of threads) {
      const hunk = key.split(":")[0] ?? "";
      out.set(hunk, new Map([...(out.get(hunk) ?? []), [key, list]]));
    }
    return out;
  }, [threads]);

  const mine = composer?.kind === "line" && composer.layer === layer.id && composer.file === file.id ? composer : null;
  const selection = (hunk: string): LineSelection | null => {
    if (drag?.hunk === hunk) {
      return { side: drag.side, from: Math.min(drag.start, drag.end), to: Math.max(drag.start, drag.end) };
    }
    return mine?.hunk === hunk ? { side: mine.side, from: mine.line, to: mine.endLine ?? mine.line } : null;
  };
  const active = useMemo<GapSelection | null>(() => {
    if (drag) {
      return { hunk: drag.hunk, side: drag.side, from: Math.min(drag.start, drag.end), to: Math.max(drag.start, drag.end) };
    }
    return mine && { hunk: mine.hunk, side: mine.side, from: mine.line, to: mine.endLine ?? mine.line };
  }, [drag, mine]);

  // A gap redraws for a drag or composer only on a hunk its lines can be named on: the hunks either side and any
  // hidden between.
  const selectionNear = (above: Hunk | null, below: Hunk | null) => {
    const start = above ? file.hunks.indexOf(above) : 0;
    const end = below ? file.hunks.indexOf(below) : file.hunks.length - 1;
    return active && file.hunks.slice(start, end + 1).some(h => h.id === active.hunk) ? active : null;
  };

  // What unchanged lines of the head a gap shows under their line: threads by their last line, and every head
  // range a thread or the open composer covers.
  const marks = useMemo<HeadMarks>(() => {
    const byLine = new Map<number, Thread[]>();
    const spans: [number, number][] = [];
    for (const [key, list] of threads) {
      const [, side, last] = key.split(":");
      const end = Number(last);
      if (side === "R") {
        byLine.set(end, [...(byLine.get(end) ?? []), ...list]);
        for (const thread of list) {
          const anchor = thread.kind === "claude" ? thread.root.anchor : null;
          spans.push([anchor?.kind === "line" ? anchor.line : end, end]);
        }
      }
    }
    if (mine?.side === "R") {
      spans.push([mine.line, mine.endLine ?? mine.line]);
    }
    return { threads: byLine, spans };
  }, [threads, mine]);

  // A press on a line number starts a range; letting go anywhere opens the composer on it.
  useEffect(() => {
    if (!drag) {
      return;
    }
    const done = () => {
      openComposer(rangeAnchor(layer.id, file.id, drag.hunk, drag.side, drag.start, drag.end));
      setDrag(null);
    };
    window.addEventListener("mouseup", done, { once: true });
    return () => window.removeEventListener("mouseup", done);
  }, [drag, layer.id, file.id]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // The offer goes when the selection does.
  useEffect(() => {
    if (!pick) {
      return;
    }
    const gone = () => {
      if (window.getSelection()?.isCollapsed !== false) {
        setPick(null);
      }
    };
    document.addEventListener("selectionchange", gone);
    return () => document.removeEventListener("selectionchange", gone);
  }, [pick]);

  const onMouseDown = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("button, a, input, textarea")) {
      return;
    }
    const cell = target.closest<HTMLElement>("td[data-ln][data-line]");
    const line = cell && lineOf(cell);
    if (line) {
      event.preventDefault();
      setPick(null);
      setDrag({ hunk: line.hunk, side: line.side, start: line.n, end: line.n });
    }
  };

  // A text selection across lines of one hunk offers a note on those lines.
  const onMouseUp = () => {
    if (drag) {
      return;
    }
    requestAnimationFrame(() => {
      const found = wrap.current ? rangeFromSelection(wrap.current) : null;
      setPick(
        found && { anchor: rangeAnchor(layer.id, file.id, found.hunk, found.side, found.from, found.to), top: found.top, left: found.left },
      );
    });
  };

  const onMouseMove = (event: MouseEvent) => {
    if (drag) {
      const cell = (event.target as HTMLElement).closest<HTMLElement>("td[data-line]");
      const line = cell && lineOf(cell);
      if (line && line.hunk === drag.hunk && line.side === drag.side && line.n !== drag.end) {
        setDrag({ ...drag, end: line.n });
      }
      return;
    }
    if (!layer.capabilities.usages) {
      return;
    }
    const { clientX, clientY, target } = event;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const cell = (target as HTMLElement).closest<HTMLElement>("td[data-ident]");
      const found = cell ? identifierAt(cell, clientX, clientY) : null;
      if (found?.word === hot.current?.word && found?.range.startContainer === hot.current?.range.startContainer) {
        return;
      }
      clearIdentifier();
      hot.current = found;
      if (found && cell) {
        CSS.highlights?.set("prg-ident", new Highlight(found.range));
        cell.dataset.hot = "";
      }
    });
  };

  const onMouseLeave = () => {
    cancelAnimationFrame(frame.current);
    hot.current = null;
    clearIdentifier();
  };

  // A pointer has hovered the name first; a tap hasn't, so the name is found where the tap landed.
  const onClick = (event: MouseEvent) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("td[data-ident]");
    const found = hot.current ?? (cell && layer.capabilities.usages ? identifierAt(cell, event.clientX, event.clientY) : null);
    if (found && window.getSelection()?.isCollapsed !== false) {
      setUsage({ word: found.word, range: found.range, rect: found.range.getBoundingClientRect() });
    }
  };

  // Rows that span the diff keep their content within the visible width when long lines scroll sideways.
  useEffect(() => {
    const element = wrap.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() => element.style.setProperty("--diff-w", `${element.clientWidth}px`));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const filtering = show.kind !== "all";
  return (
    <DiffContext.Provider value={context}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer shortcuts; each has a button or link for the keyboard */}
      <div
        ref={wrap}
        className="prg-diff relative overflow-x-auto overflow-y-hidden"
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
      >
        {elsewhere.length > 0 && (
          <p className="border-b bg-card px-3 py-1.5 font-sans text-[12.5px] text-muted-foreground">
            Your checkout also changes {elsewhere.length === 1 ? "line" : "lines"} {elsewhere.join(", ")} of this file, outside what the
            pull request touches. Open the unchanged lines there to preview it.
          </p>
        )}
        <table
          className={cn(
            "w-full border-collapse font-mono text-[12.5px] leading-[1.6] [font-variant-ligatures:none]",
            split && "table-fixed",
          )}
        >
          {split && (
            <colgroup>
              <col className="w-[4.25rem]" />
              <col className="w-[1.2rem]" />
              <col />
              <col className="w-[4.25rem]" />
              <col className="w-[1.2rem]" />
              <col />
            </colgroup>
          )}
          {hunks.map((hunk, i) => {
            const gap = gaps.before.get(hunk.id) ?? null;
            const links = crossLinks.get(hunk.id);
            return (
              <Fragment key={hunk.id}>
                <GapBody
                  key={gap ? `${gap.from}-${gap.to}` : "none"}
                  gap={gap}
                  hunk={hunk}
                  prev={hunks[i - 1] ?? null}
                  marks={marks}
                  composer={mine}
                  selection={selectionNear(hunks[i - 1] ?? null, hunk)}
                />
                <HunkBody
                  hunk={hunk}
                  dim={(filtering && !showsHunk(show, hunk)) || (changed.size > 0 && !changed.has(hunk.id))}
                  changed={changed.has(hunk.id)}
                  threads={byHunk.get(hunk.id) ?? NO_THREADS}
                  composer={mine?.hunk === hunk.id ? mine : null}
                  selection={selection(hunk.id)}
                />
                {links && (
                  <tbody>
                    <CrossLayerRow links={links} />
                  </tbody>
                )}
              </Fragment>
            );
          })}
          {gaps.after && (
            <GapBody
              key={`${gaps.after.from}-${gaps.after.to}`}
              gap={gaps.after}
              hunk={null}
              prev={hunks.at(-1) ?? null}
              marks={marks}
              composer={mine}
              selection={selectionNear(hunks.at(-1) ?? null, null)}
            />
          )}
        </table>
        {pick && (
          <button
            type="button"
            onMouseDown={event => {
              event.stopPropagation();
              event.preventDefault();
            }}
            onClick={() => {
              openComposer(pick.anchor);
              setPick(null);
              window.getSelection()?.removeAllRanges();
            }}
            style={{ top: pick.top, left: pick.left }}
            className="absolute z-10 cursor-pointer rounded-md border bg-popover px-2 py-1 font-sans text-popover-foreground text-xs shadow-md hover:text-primary"
          >
            Note on lines {pick.anchor.line} to {pick.anchor.endLine ?? pick.anchor.line}
          </button>
        )}
        {usage && <UsagesPopover layer={layer.id} target={usage} onClose={() => setUsage(null)} />}
      </div>
      {reverting && <RevertDialog layer={layer.id} file={file.id} path={file.path} edit={reverting} onClose={() => setReverting(null)} />}
    </DiffContext.Provider>
  );
}
