import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { Fragment, memo, type ReactNode, useMemo, useState } from "react";
import type { LineAnchor } from "shared/messages";
import type { Hunk, HunkLine } from "shared/payload";
import { AskClaude } from "src/components/chat/AskClaude";
import type { Thread } from "src/components/chat/useThreads";
import { useDiff } from "src/components/diff/context";
import { useGapStore } from "src/components/diff/gaps.store";
import { useHighlighter, useNear } from "src/components/diff/hooks";
import { FullRow, Half, LineExtras } from "src/components/diff/Rows";
import { useFileLines } from "src/queries/lines.query";
import { useViewStore } from "src/store/view.store";
import { cardElementId } from "src/utils/anchors";
import { cn } from "src/utils/cn";
import { bruBlockAt, type Gap, oldLineOf, type Segment } from "src/utils/diff";

// How many lines one press of the up or down arrow reveals.
const STEP = 20;

const pad = (n: number) => String(n).padStart(2, "0");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Step({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid size-5 cursor-pointer place-items-center rounded hover:bg-background hover:text-primary [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

// Threads on lines of the head by the line they show under, and the head lines each thread or the open composer
// covers, which a gap opens far enough to show.
export type HeadMarks = { threads: Map<number, Thread[]>; spans: [from: number, to: number][] };
export type GapSelection = { hunk: string; side: "L" | "R"; from: number; to: number };

type RevealedProps = {
  from: number;
  texts: string[];
  segments: Segment[][] | null;
  // The hunk a note on line n is named on.
  hunkAt: (n: number) => string | null;
  marks: HeadMarks;
  composer: LineAnchor | null;
  selection: GapSelection | null;
};

// Lines of the new file shown as context, numbered on both sides, highlighted once near the viewport. Each takes a
// note like a line of a hunk.
function Revealed({ from, texts, segments, hunkAt, marks, composer, selection }: RevealedProps) {
  const { layer, file, split, local } = useDiff();
  return texts.map((text, k) => {
    const n = from + k;
    const row: HunkLine = [" ", oldLineOf(file.hunks, n), n, text];
    const hunk = hunkAt(n);
    const anchor: LineAnchor | null = hunk ? { kind: "line", layer: layer.id, file: file.id, hunk, side: "R", line: n } : null;
    const selected = Boolean(hunk && selection?.side === "R" && selection.hunk === hunk && n >= selection.from && n <= selection.to);
    return (
      <Fragment key={n}>
        <tr className={cn("group/row motion-fade", local.hidden.has(n) && "hidden")}>
          {split && <Half row={row} old segments={segments?.[k]} />}
          <Half row={row} anchor={anchor} segments={segments?.[k]} selected={selected} threaded={marks.threads.has(n)} right={split} />
        </tr>
        {anchor && <LineExtras anchor={anchor} threads={marks.threads.get(n)} composer={composer} />}
      </Fragment>
    );
  });
}

// A run of revealed lines highlighted once, rather than on every render a drag or the composer causes.
function useSegments(texts: string[], near: boolean, language: string | null, block: string | null) {
  const highlight = useHighlighter();
  const source = texts.join("\n");
  return useMemo(
    () => (near && highlight && texts.length > 0 ? highlight.highlightLines(source.split("\n"), language, block) : null),
    [near, highlight, source, texts.length, language, block],
  );
}

type GapBodyProps = {
  // The lines above `hunk` (or after the card's last hunk) that the card doesn't show.
  gap: Gap | null;
  // The hunk below, whose scope line and Ask Claude sit on this bar; null after the last.
  hunk: Hunk | null;
  // The shown hunk above, from which lines can be revealed downwards; null before the first.
  prev: Hunk | null;
  marks: HeadMarks;
  composer: LineAnchor | null;
  selection: GapSelection | null;
};

// The bar above a hunk: the unchanged lines before it, which expand in place a step at a time or all at once, or
// the section that shows the hunks hidden there; then the hunk's enclosing scope and Ask Claude. A thread on a line
// in the gap opens it far enough to show the thread, from whichever end is nearer.
export const GapBody = memo(function GapBody({ gap, hunk, prev, marks, composer, selection }: GapBodyProps) {
  const { layer, file, section, language } = useDiff();
  const goTo = useViewStore(state => state.goTo);
  const command = useGapStore(state => state.command);
  const [shown, setShown] = useState({ top: 0, bottom: 0 });
  const [seen, setSeen] = useState(command?.seq ?? 0);
  const [ref, near] = useNear<HTMLTableSectionElement>();
  const owners = useMemo(
    () => new Map(file.hunks.flatMap(h => h.lines.flatMap(row => (row[0] === "-" ? [] : [[row[2] as number, h.id] as const])))),
    [file],
  );

  const count = gap ? gap.to - gap.from + 1 : 0;
  const expandable = gap !== null && gap.elsewhere === null && gap.expandable;
  let top = shown.top;
  let bottom = shown.bottom;
  for (const [a, b] of gap && expandable ? marks.spans : []) {
    const from = Math.max(a, gap?.from ?? 0);
    const to = Math.min(b, gap?.to ?? 0);
    const viaTop = to - (gap?.from ?? 0) + 1;
    const viaBottom = (gap?.to ?? 0) - from + 1;
    if (from <= to && viaTop <= viaBottom) {
      top = Math.max(top, viaTop);
    } else if (from <= to) {
      bottom = Math.max(bottom, viaBottom);
    }
  }
  if (top + bottom >= count) {
    top = count;
    bottom = 0;
  }
  const remaining = count - top - bottom;

  const reveal = (where: "top" | "bottom" | "all") => {
    const step = where === "all" ? remaining : Math.min(STEP, remaining);
    setShown(where === "bottom" ? { top, bottom: bottom + step } : { top: top + step, bottom });
  };

  if (command && command.seq !== seen) {
    setSeen(command.seq);
    if (expandable && command.card === cardElementId(layer.id, file.id, section)) {
      if (command.act === "close") {
        setShown({ top: 0, bottom: 0 });
      } else if (remaining > 0 && command.act === "open") {
        reveal("all");
      } else if (remaining > 0 && command.act === "up" && command.hunk === hunk?.id) {
        reveal("bottom");
      } else if (remaining > 0 && command.act === "down" && command.hunk === prev?.id) {
        reveal("top");
      }
    }
  }

  // A line inside a hunk this card doesn't show is named on that hunk, any other on the hunk beside it.
  const hunkAt = (towards: Hunk | null) => (n: number) => owners.get(n) ?? towards?.id ?? null;

  const ranges: [number, number][] = [];
  if (gap && top > 0) {
    ranges.push([gap.from, gap.from + top - 1]);
  }
  if (gap && bottom > 0) {
    ranges.push([gap.to - bottom + 1, gap.to]);
  }
  const { line, pending, failed } = useFileLines(layer.id, file.id, ranges);

  const lines = (from: number, count: number) => {
    const texts: string[] = [];
    for (let n = from; n < from + count; n++) {
      const text = line(n);
      if (text === undefined) {
        return [];
      }
      texts.push(text);
    }
    return texts;
  };
  const headFrom = gap?.from ?? 0;
  const tailFrom = gap ? gap.to - bottom + 1 : 0;
  const headTexts = lines(headFrom, top);
  const tailTexts = lines(tailFrom, bottom);
  const headSegments = useSegments(headTexts, near, language, bruBlockAt(file.bruBlocks, headFrom));
  const tailSegments = useSegments(tailTexts, near, language, bruBlockAt(file.bruBlocks, tailFrom));
  const head = top > 0 ? { from: headFrom, texts: headTexts, segments: headSegments, hunkAt: hunkAt(prev ?? hunk) } : null;
  const tail = bottom > 0 ? { from: tailFrom, texts: tailTexts, segments: tailSegments, hunkAt: hunkAt(hunk ?? prev) } : null;

  const open = gap !== null && (gap.elsewhere !== null || remaining > 0);

  let what: ReactNode = null;
  if (gap?.elsewhere) {
    const holder = layer.sections[gap.elsewhere.section];
    const target = gap.elsewhere.hunk;
    what = (
      <span className="min-w-0">
        {count > 0 ? `${plural(count, "line")} between, with changes shown in ` : "Changes shown in "}
        <button
          type="button"
          onClick={() => goTo(layer.id, target)}
          className="cursor-pointer underline decoration-dotted underline-offset-3 hover:text-primary"
        >
          §{pad(gap.elsewhere.section + 1)} {holder?.title ?? ""}
        </button>
      </span>
    );
  } else if (gap && remaining > 0) {
    const label = plural(remaining, "unchanged line");
    what = !gap.expandable ? (
      <span className="shrink-0 whitespace-nowrap">{label}</span>
    ) : (
      <span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap">
        {remaining > STEP && prev && (
          <Step label={`Show ${STEP} more lines below the change above`} onClick={() => reveal("top")}>
            <ChevronDown />
          </Step>
        )}
        {remaining > STEP && hunk && (
          <Step label={`Show ${STEP} more lines above the change below`} onClick={() => reveal("bottom")}>
            <ChevronUp />
          </Step>
        )}
        <button
          type="button"
          onClick={() => reveal("all")}
          title="Show all of them"
          className="ml-0.5 inline-flex cursor-pointer items-center gap-1 hover:text-primary [&_svg]:size-3.5"
        >
          {remaining <= STEP && <ChevronsUpDown />}
          {label}
        </button>
        {pending && <span className="motion-loading ml-2">Loading…</span>}
        {failed && <span className="ml-2 text-danger">Those lines didn't load.</span>}
      </span>
    );
  }

  const bar = (
    <FullRow className="flex min-h-6 items-center gap-x-3 bg-muted px-2.5 py-0.5 text-[12.5px] text-muted-foreground">
      {what}
      {hunk?.header && <span className="min-w-0 truncate font-mono opacity-80">{hunk.header}</span>}
      {hunk && (
        <AskClaude
          anchor={{ kind: "hunk", layer: layer.id, file: file.id, hunk: hunk.id }}
          label="Ask Claude"
          className="ml-auto shrink-0"
        />
      )}
    </FullRow>
  );

  return (
    <tbody ref={ref} data-gap-hidden={expandable && remaining > 0 ? remaining : undefined}>
      {head && <Revealed {...head} marks={marks} composer={composer} selection={selection} />}
      {open && bar}
      {tail && <Revealed {...tail} marks={marks} composer={composer} selection={selection} />}
      {!open && hunk && bar}
    </tbody>
  );
});
