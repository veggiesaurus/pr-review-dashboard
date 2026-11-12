import { Eye, EyeOff, Plus } from "lucide-react";
import type { ReactNode } from "react";
import type { LocalEdit } from "shared/local";
import type { LineAnchor } from "shared/messages";
import type { HunkLine } from "shared/payload";
import { AskClaude } from "src/components/chat/AskClaude";
import { ComposerSlot } from "src/components/chat/Composer";
import { openComposer } from "src/components/chat/chat.store";
import { ThreadBlock } from "src/components/chat/ThreadBlock";
import type { Thread } from "src/components/chat/useThreads";
import { CodeText } from "src/components/diff/CodeText";
import { useDiff } from "src/components/diff/context";
import { Badge } from "src/components/ui/badge";
import { lineElementId, lineKey } from "src/utils/anchors";
import { cn } from "src/utils/cn";
import { hasNames, type Range, type Segment } from "src/utils/diff";

const SIGN = { "+": "+", "-": "−", " ": "" };

// A row across the whole diff, whose content stays in view when long lines scroll the code sideways. grow opens it
// from nothing, for what a click puts there; a table row can't be clipped, so a box in the cell does it.
export function FullRow({ id, className, grow, children }: { id?: string; className?: string; grow?: boolean; children: ReactNode }) {
  const { cols } = useDiff();
  const content = <div className={cn("sticky left-0 w-[var(--diff-w,100%)] font-sans", className)}>{children}</div>;
  return (
    <tr id={id}>
      <td colSpan={cols} className="p-0">
        {grow ? <div className="motion-grow">{content}</div> : content}
      </td>
    </tr>
  );
}

export type HalfProps = {
  // null draws an empty half of a split row.
  row: HunkLine | null;
  // The left half of a split context line, numbered in the base and not a place for notes.
  old?: boolean;
  anchor?: LineAnchor | null;
  tone?: "moved" | "noise" | null;
  segments?: Segment[] | null;
  marks?: Range[] | null;
  // The hunk is new since the last build: a bar down its first number column.
  fresh?: boolean;
  selected?: boolean;
  threaded?: boolean;
  // Identifiers in it can be clicked for their usages.
  changed?: boolean;
  // The right half of a split row, which draws the line between the halves.
  right?: boolean;
};

// One side of one line: its number (where notes start), its sign and its code.
export function Half({ row, old, anchor, tone, segments, marks, fresh, selected, threaded, changed, right }: HalfProps) {
  const { layer, file, split, tells, local } = useDiff();
  if (!row) {
    return (
      <>
        <td className={cn("bg-muted", right && "border-l")} />
        <td className="bg-muted" />
        <td className="bg-muted" />
      </>
    );
  }
  const [sign, oldNo, newNo, text] = row;
  const number = sign === "-" || old ? oldNo : newNo;
  const at = anchor ? `${anchor.side}${anchor.line}` : null;
  const flags = at ? tells.get(at) : undefined;
  const fill = tone === "moved" ? "bg-primary/8" : sign === "+" ? "bg-diff-add" : sign === "-" ? "bg-diff-del" : "";
  const data = anchor ? { "data-hunk": anchor.hunk, "data-line": at } : {};
  // The checkout's code differs from here on; the button swaps it in for what was reviewed.
  const edit = !old && sign !== "-" && newNo !== null ? local.marks.get(newNo) : undefined;
  return (
    <>
      <td
        id={at ? lineElementId(layer.id, file.id, at) : undefined}
        data-ln=""
        {...data}
        className={cn(
          "relative select-none whitespace-nowrap pr-1.5 pl-2.5 text-right align-top text-muted-foreground",
          // The wide gutter leaves room for the +, which a touch screen never shows.
          !split && "w-[1%] min-w-[4.25rem] max-sm:min-w-[2.5rem] max-sm:pl-1",
          right && "border-l",
          fill,
          anchor && "cursor-pointer",
          tone === "noise" && "before:absolute before:left-1 before:text-[9.5px] before:tracking-wide before:content-['fmt']",
          fresh && "shadow-[inset_2px_0_0_var(--primary)]",
          threaded && "shadow-[inset_3px_0_0_var(--warning)]",
          selected && "bg-primary/20 text-foreground",
        )}
      >
        {anchor && (
          <button
            type="button"
            onClick={() => openComposer(anchor)}
            title="Add a note or ask Claude about this line"
            aria-label={`Note on line ${number}`}
            className="absolute top-0.5 left-3 grid size-4 cursor-pointer place-items-center rounded-[4px] bg-primary text-primary-foreground opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100"
          >
            <Plus className="size-3" strokeWidth={2.5} />
          </button>
        )}
        {edit && (
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              local.toggle(edit);
            }}
            title="Your checkout's code differs here. Click to see it in place of what was reviewed."
            aria-label={`Preview the local code at line ${number}`}
            className="absolute top-0.5 left-0 grid size-4 cursor-pointer place-items-center rounded-[4px] text-primary hover:bg-primary hover:text-primary-foreground"
          >
            <Eye className="size-3" strokeWidth={2.25} />
          </button>
        )}
        {number}
        {flags && at && (
          <button
            type="button"
            onClick={() => openComposer({ kind: "tell", layer: layer.id, file: file.id, line: at })}
            title={`${flags.map(flag => flag.label).join(", ")}. Click to ask Claude about it.`}
            aria-label={`Flagged: ${flags.map(flag => flag.label).join(", ")}. Ask Claude about it`}
            className="absolute top-0 right-0.5 cursor-pointer font-bold font-sans text-[11px] text-danger leading-[1.6]"
          >
            !
          </button>
        )}
      </td>
      <td
        className={cn(
          "w-[1.2rem] min-w-[1.2rem] select-none text-center align-top",
          fill,
          tone === "moved" ? "text-primary" : sign === "+" ? "text-success" : sign === "-" ? "text-danger" : "text-muted-foreground",
          tone === "noise" && "opacity-55",
        )}
      >
        {SIGN[sign]}
      </td>
      <td
        {...data}
        data-ident={changed && tone !== "noise" && hasNames(file) ? "" : undefined}
        className={cn(
          "align-top [&_mark]:rounded-[2px] [&_mark]:text-inherit data-hot:cursor-pointer",
          // On a phone a long line wraps rather than running off the side of the card.
          split
            ? "whitespace-pre-wrap pr-3 [overflow-wrap:anywhere]"
            : "whitespace-pre pr-6 max-sm:whitespace-pre-wrap max-sm:pr-2 max-sm:[overflow-wrap:anywhere]",
          fill,
          sign === "+" ? "[&_mark]:bg-diff-add-edge" : "[&_mark]:bg-diff-del-edge",
          tone === "noise" && "opacity-55",
        )}
      >
        <CodeText text={text} segments={segments} marks={marks} />
      </td>
    </>
  );
}

// What hangs under a line: its CI annotations, its threads and, while open, the composer.
// A previewed edit: the checkout's lines as rows of the table, standing in for the reviewed lines above them, which
// are hidden meanwhile. The first row's button puts the reviewed code back.
function LocalRows({ edits }: { edits: LocalEdit[] | undefined }) {
  const { split, local } = useDiff();
  const fill = "bg-primary/8";
  return edits?.flatMap((edit, e) =>
    // An edit that only removes lines still needs a row to say so and to switch back from.
    (edit.add.length ? edit.add : [null]).map((text, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: an edit's lines have no id and keep their order
      <tr key={`${e}:${i}`} data-local="">
        {split && (
          <>
            <td className="bg-muted" />
            <td className="bg-muted" />
            <td className="bg-muted" />
          </>
        )}
        <td
          className={cn(
            // The same box as a numbered cell, so previewing doesn't move the columns.
            "relative select-none whitespace-nowrap pr-1.5 pl-2.5 align-top shadow-[inset_2px_0_0_var(--primary)]",
            !split && "w-[1%] min-w-[4.25rem] max-sm:min-w-[2.5rem] max-sm:pl-1",
            split && "border-l",
            fill,
          )}
        >
          {i === 0 && (
            <button
              type="button"
              onClick={() => local.toggle(edit)}
              title="This is your checkout's code. Click for the code as reviewed."
              aria-label="Show the code as reviewed"
              className="absolute top-0.5 left-0 grid size-4 cursor-pointer place-items-center rounded-[4px] bg-primary text-primary-foreground"
            >
              <EyeOff className="size-3" strokeWidth={2.25} />
            </button>
          )}
        </td>
        <td className={cn("w-[1.2rem] min-w-[1.2rem] select-none text-center align-top text-primary", fill)}>{text === null ? "" : "~"}</td>
        <td
          className={cn(
            "align-top",
            split
              ? "whitespace-pre-wrap pr-3 [overflow-wrap:anywhere]"
              : "whitespace-pre pr-6 max-sm:whitespace-pre-wrap max-sm:pr-2 max-sm:[overflow-wrap:anywhere]",
            fill,
            text === null && "font-sans text-muted-foreground",
          )}
        >
          {text === null
            ? `Your checkout removes ${edit.gone.length === 1 ? "this line" : `these ${edit.gone.length} lines`}.`
            : text || " "}
        </td>
      </tr>
    )),
  );
}

export function LineExtras({
  anchor,
  threads,
  composer,
}: {
  anchor: LineAnchor;
  threads: Thread[] | undefined;
  composer: LineAnchor | null;
}) {
  const { layer, annotations, local } = useDiff();
  const at = `${anchor.side}${anchor.line}`;
  const key = lineKey(anchor);
  return (
    <>
      <LocalRows edits={local.shown.get(at)} />
      {annotations.get(at)?.map(({ annotation, index }) => (
        <FullRow key={`a${index}`} className="border-y bg-card py-1.5 pr-3 pl-3 text-[13px] sm:pl-[4.6rem]">
          <Badge tone={annotation.level === "failure" ? "danger" : "warning"} className="mr-2 uppercase tracking-wide">
            {annotation.level}
          </Badge>
          {annotation.title && <b className="mr-1 font-semibold">{annotation.title}</b>}
          <span className="whitespace-pre-wrap">{annotation.message}</span>{" "}
          <span className="text-muted-foreground">
            {annotation.link?.startsWith("https://") ? (
              <a href={annotation.link} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                {annotation.check}
              </a>
            ) : (
              annotation.check
            )}
          </span>
          <AskClaude anchor={{ kind: "annotation", layer: layer.id, index }} label="Ask Claude" className="ml-3 align-middle" />
        </FullRow>
      ))}
      {threads?.map(thread => (
        <FullRow key={thread.root.id}>
          <ThreadBlock thread={thread} />
        </FullRow>
      ))}
      {composer && lineKey(composer) === key && (
        <FullRow grow>
          <ComposerSlot anchor={composer} />
        </FullRow>
      )}
    </>
  );
}
