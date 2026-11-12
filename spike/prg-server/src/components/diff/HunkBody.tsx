import { Fragment, memo, useMemo, useState } from "react";
import type { LineAnchor } from "shared/messages";
import type { Hunk, HunkLine, Move } from "shared/payload";
import type { Thread } from "src/components/chat/useThreads";
import { useDiff } from "src/components/diff/context";
import { useHighlighter, useNear } from "src/components/diff/hooks";
import { FullRow, Half, LineExtras } from "src/components/diff/Rows";
import { useViewStore } from "src/store/view.store";
import { hunkElementId, lineKey } from "src/utils/anchors";
import { cn } from "src/utils/cn";
import { bruBlockAt, hunkUnits, layoutRows, type Segment, wordMarks } from "src/utils/diff";
import { lineAnchor } from "src/utils/lines";
import { indexLayer } from "src/utils/payload";

// A long deleted file shows its first rows until asked for the rest, as the template does.
const DELETED_PREVIEW = 30;
const DELETED_LONG = 200;

export type LineSelection = { side: "L" | "R"; from: number; to: number };

const pad = (n: number) => String(n).padStart(2, "0");

// The row a moved block shows as: where it went, with its lines behind Show them, or where it came from.
function MoveRow({ id, move, hunk, onShow }: { id?: string; move: Move; hunk: Hunk; onShow: () => void }) {
  const { layer, section } = useDiff();
  const goTo = useViewStore(state => state.goTo);
  const index = indexLayer(layer);
  const other = index.hunks.get(move.side === "-" ? move.to : move.from);
  const count = move.end - move.start;
  const there = other ? `${other.file.path}:${move.line.slice(1)}` : move.side === "-" ? move.to : move.from;
  const theirs = other ? index.owner.get(other.hunk.id) : undefined;
  const elsewhere = section !== undefined && theirs !== undefined && theirs !== index.owner.get(hunk.id) ? ` in §${pad(theirs + 1)}` : "";
  const link = (
    <button
      type="button"
      disabled={!other}
      onClick={() => other && goTo(layer.id, `${other.file.id}:${move.line}`)}
      className="cursor-pointer underline decoration-dotted underline-offset-3 hover:text-primary disabled:cursor-default"
    >
      {there}
    </button>
  );
  return (
    <FullRow id={id} className="bg-primary/8 px-2.5 py-0.5 text-[12.5px] text-muted-foreground">
      {move.side === "-" ? (
        <>
          {count} lines moved unchanged to {link}
          {elsewhere}
          <button
            type="button"
            onClick={onShow}
            className="ml-2 cursor-pointer underline decoration-dotted underline-offset-3 hover:text-primary"
          >
            Show them
          </button>
        </>
      ) : (
        <>
          {count} lines moved here unchanged from {link}
          {elsewhere}
        </>
      )}
    </FullRow>
  );
}

// Each line's highlighting, both sides highlighted as runs so constructs that span lines read right.
function highlightHunk(highlight: typeof import("src/utils/highlight"), hunk: Hunk, language: string | null, block: string | null) {
  const out: (Segment[] | undefined)[] = new Array(hunk.lines.length);
  for (const side of ["-", "+"]) {
    const indexes = hunk.lines.flatMap((row, i) => (row[0] === side ? [] : [i]));
    const lines = highlight.highlightLines(
      indexes.map(i => hunk.lines[i]?.[3] ?? ""),
      language,
      block,
    );
    indexes.forEach((i, k) => {
      if (out[i] === undefined || hunk.lines[i]?.[0] !== " ") {
        out[i] = lines[k];
      }
    });
  }
  return out;
}

type HunkBodyProps = {
  hunk: Hunk;
  dim: boolean;
  threads: Map<string, Thread[]>;
  composer: LineAnchor | null;
  selection: LineSelection | null;
};

// One hunk's rows in their own tbody, which the filter dims as one.
export const HunkBody = memo(function HunkBody({ hunk, dim, threads, composer, selection }: HunkBodyProps) {
  const { layer, file, split, formatting, language, local } = useDiff();
  const fresh = Boolean(layer.meta.lastPass && hunk.fresh);
  const [shownMoves, setShownMoves] = useState<ReadonlySet<number>>(() => new Set());
  const [whole, setWhole] = useState(false);
  const [ref, near] = useNear<HTMLTableSectionElement>();
  // A head line a previewed local edit stands in for.
  const stoodIn = (half: { old?: boolean; unit: { row: HunkLine } } | null | undefined) =>
    Boolean(half && !half.old && half.unit.row[0] !== "-" && half.unit.row[2] !== null && local.hidden.has(half.unit.row[2]));
  const highlight = useHighlighter();

  const rows = useMemo(() => layoutRows(hunkUnits(hunk, formatting, shownMoves), split), [hunk, formatting, shownMoves, split]);
  const segments = useMemo(
    () => (near && highlight ? highlightHunk(highlight, hunk, language, bruBlockAt(file.bruBlocks, hunk.newStart)) : null),
    [near, highlight, hunk, language, file.bruBlocks],
  );
  const marks = useMemo(() => (near ? wordMarks(hunk) : null), [near, hunk]);

  const cut = file.status === "deleted" && rows.length > DELETED_LONG && !whole ? DELETED_PREVIEW : rows.length;
  const first = Math.max(
    0,
    rows.findIndex(row => row.kind === "move" || row.halves.some(half => half && half.unit.row[0] !== " ")),
  );
  const id = hunkElementId(layer.id, hunk.id);

  return (
    <tbody ref={ref} data-hunk={hunk.id} className={cn(dim && "opacity-35")}>
      {rows.slice(0, cut).map((row, r) => {
        if (row.kind === "move") {
          return (
            <MoveRow
              key={`m${row.move.start}`}
              id={r === first ? id : undefined}
              move={row.move}
              hunk={hunk}
              onShow={() => setShownMoves(prev => new Set([...prev, row.move.start]))}
            />
          );
        }
        const anchors = row.halves.map(half => (half && !half.old ? lineAnchor(layer.id, file.id, hunk, half.unit.row) : null));
        const key = row.halves.map(half => (half ? `${half.old ? "o" : ""}${half.unit.index}` : "-")).join(":");
        return (
          <Fragment key={key}>
            <tr
              id={r === first ? id : undefined}
              className={cn(
                "group/row",
                row.halves.every(half => !half || half.old || stoodIn(half)) && row.halves.some(stoodIn) && "hidden",
              )}
            >
              {row.halves.map((half, h) => {
                const anchor = anchors[h] ?? null;
                return (
                  <Half
                    // biome-ignore lint/suspicious/noArrayIndexKey: a row's halves are left then right
                    key={h}
                    // In a split row that pairs a removed line with one a preview stands in for, only that side goes.
                    row={half && !stoodIn(half) ? half.unit.row : null}
                    old={half?.old}
                    anchor={anchor}
                    tone={half?.unit.tone}
                    segments={half ? segments?.[half.unit.index] : null}
                    marks={half && !half.old ? marks?.get(half.unit.index) : null}
                    fresh={fresh && h === 0}
                    selected={Boolean(
                      anchor && selection && anchor.side === selection.side && anchor.line >= selection.from && anchor.line <= selection.to,
                    )}
                    threaded={Boolean(anchor && threads.has(lineKey(anchor)))}
                    changed={half ? half.unit.row[0] !== " " : false}
                    right={h === 1}
                  />
                );
              })}
            </tr>
            {anchors.map(anchor =>
              anchor ? (
                <LineExtras key={lineKey(anchor)} anchor={anchor} threads={threads.get(lineKey(anchor))} composer={composer} />
              ) : null,
            )}
          </Fragment>
        );
      })}
      {cut < rows.length && (
        <FullRow className="bg-muted px-2.5 py-0.5 text-[12.5px] text-muted-foreground">
          <button type="button" onClick={() => setWhole(true)} className="cursor-pointer hover:text-primary">
            Show {rows.length - cut} more removed lines
          </button>
        </FullRow>
      )}
    </tbody>
  );
});
