import "src/components/diff/diff.css";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { DiffTable } from "src/components/diff/DiffTable";
import { ReviewedTick } from "src/components/guide/ReviewedTick";
import { formattingOnly } from "src/components/guide/visible";
import { Button } from "src/components/ui/button";
import { useLayer } from "src/queries/review.query";
import { useCardDone } from "src/store/ticks.store";
import { useViewStore } from "src/store/view.store";
import { cardDataAttribute, cardElementId } from "src/utils/anchors";
import { cn } from "src/utils/cn";
import { showsHunk, splitPath } from "src/utils/diff";
import { indexLayer } from "src/utils/payload";

function Tag({ title, className, children }: { title?: string; className?: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className={cn(
        "whitespace-nowrap rounded-full border px-2 py-px text-[11px] text-muted-foreground uppercase tracking-wide",
        className,
      )}
    >
      {children}
    </span>
  );
}

const FORMATTING_HIDDEN = "Only formatting changes here, hidden while Formatting is off.";

function Note({ children }: { children: ReactNode }) {
  return <div className="grid justify-items-center gap-2 px-3 py-5 text-center text-muted-foreground text-sm">{children}</div>;
}

// One file's card. hunkIds limits it to the hunks a section holds; section is that section's index, which keeps the
// card's id apart from the same file's cards in other sections.
export function FileCard({
  layer: layerId,
  file: fileId,
  hunkIds,
  section,
}: {
  layer: number;
  file: string;
  hunkIds?: string[];
  section?: number;
}) {
  const layer = useLayer(layerId);
  const formatting = useViewStore(state => state.formatting);
  const show = useViewStore(state => state.show);
  const file = layer ? indexLayer(layer).files.get(fileId) : undefined;
  const ticked = useCardDone(layerId, fileId, hunkIds);
  const kind = section === undefined ? undefined : layer?.sections[section]?.kind;
  // Lock, generated and formatting-only cards don't fold when ticked on load, as in the template.
  const quiet = Boolean(file?.noise) || kind === "formatting";
  // In the Diff tab a file with only formatting changes stays folded while formatting is hidden.
  const folded = hunkIds === undefined && !formatting && file !== undefined && formattingOnly(file);
  const [open, setOpen] = useState(() => !folded && (!ticked || quiet));
  const [noiseShown, setNoiseShown] = useState(false);
  const wasTicked = useRef(ticked);
  const wasFolded = useRef(folded);

  useEffect(() => {
    if (wasTicked.current !== ticked) {
      wasTicked.current = ticked;
      setOpen(!ticked);
    }
  }, [ticked]);

  useEffect(() => {
    if (wasFolded.current !== folded) {
      wasFolded.current = folded;
      setOpen(!folded && !ticked);
    }
  }, [folded, ticked]);

  if (!layer || !file) {
    return null;
  }
  const hunks = hunkIds ? file.hunks.filter(hunk => hunkIds.includes(hunk.id)) : file.hunks.filter(hunk => formatting || !hunk.noise);
  if (show.kind !== "all" && !(folded ? file.hunks : hunks).some(hunk => showsHunk(show, hunk))) {
    return null;
  }

  const counted = hunkIds && file.hunks.length ? hunks.flatMap(hunk => hunk.lines) : null;
  const additions = counted ? counted.filter(line => line[0] === "+").length : file.additions;
  const deletions = counted ? counted.filter(line => line[0] === "-").length : file.deletions;
  const index = indexLayer(layer);
  const part =
    kind === "guide" &&
    file.hunks.some(hunk => {
      const at = index.owner.get(hunk.id);
      return !hunkIds?.includes(hunk.id) && at !== undefined && (formatting || layer.sections[at]?.kind !== "formatting");
    });
  const fresh = Boolean(layer.meta.lastPass && hunks.some(hunk => hunk.fresh));
  const [name, folder] = splitPath(file.path);

  let body: ReactNode;
  if (file.binary) {
    body = <Note>Binary file, nothing to show.</Note>;
  } else if (file.hunks.length === 0) {
    body = (
      <Note>
        {file.status === "renamed" ? (
          <span>
            Renamed from <code className="font-mono text-[13px]">{file.oldPath}</code> with no changes.
          </span>
        ) : (
          "No line changes."
        )}
      </Note>
    );
  } else if (file.noise && !noiseShown) {
    body = (
      <Note>
        {file.category === "lockfile" ? "Lock files" : "Generated files"} are not shown by default.
        <Button size="sm" variant="outline" onClick={() => setNoiseShown(true)}>
          Show diff
        </Button>
      </Note>
    );
  } else if (hunks.length === 0) {
    body = <Note>{FORMATTING_HIDDEN}</Note>;
  } else {
    body = <DiffTable layer={layer} file={file} hunks={hunks} section={section} />;
  }

  return (
    <article
      id={cardElementId(layer.id, file.id, section)}
      data-card={cardDataAttribute(layer.id, file.id)}
      className="min-w-0 scroll-mt-4 overflow-hidden rounded-lg border bg-muted shadow-xs"
    >
      <header className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 bg-muted px-2 py-1.5", open && "border-b")}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? `Collapse ${file.path}` : `Expand ${file.path}`}
          className="grid size-6 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} />
        </button>
        <div className="flex min-w-0 flex-[1_1_16rem] items-baseline gap-2 overflow-hidden" title={file.path}>
          <span
            className={cn(
              "whitespace-nowrap font-semibold text-sm",
              file.status === "added" && "text-success",
              file.status === "deleted" && "line-through",
            )}
          >
            {name}
          </span>
          <span className="truncate text-[12.5px] text-muted-foreground">{folder}</span>
          {file.status === "renamed" && (
            <span className="truncate text-[12.5px] text-muted-foreground" title={`Renamed from ${file.oldPath}`}>
              from <span className="font-mono">{file.oldPath}</span>
            </span>
          )}
        </div>
        {file.status !== "modified" && <Tag title={file.status === "renamed" ? `from ${file.oldPath}` : undefined}>{file.status}</Tag>}
        {file.category !== "implementation" && <Tag title={file.why ?? undefined}>{file.category}</Tag>}
        {part && (
          <Tag title="Other hunks of this file are in other sections" className="border-dashed">
            part
          </Tag>
        )}
        {fresh && (
          <Tag
            title={`Changed since the page built at ${layer.meta.lastPass?.headSha.slice(0, 7)}`}
            className="border-primary text-primary"
          >
            new
          </Tag>
        )}
        <span className="whitespace-nowrap font-mono text-xs">
          {additions > 0 && <span className="text-success">+{additions}</span>}{" "}
          {deletions > 0 && <span className="text-danger">−{deletions}</span>}
          {additions === 0 && deletions === 0 && <span className="text-muted-foreground">±0</span>}
        </span>
        <ReviewedTick layer={layer.id} file={file.id} hunkIds={hunkIds} />
        {folded && !open && <p className="basis-full pl-8 text-[12.5px] text-muted-foreground">{FORMATTING_HIDDEN}</p>}
      </header>
      <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="motion-expand">
        <summary hidden />
        {/* The card is the header's colour behind this, so a body folding away never leaves a paler sliver under square corners. */}
        <div className="bg-card">{body}</div>
      </details>
    </article>
  );
}
