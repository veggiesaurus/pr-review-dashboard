import type { ReviewFile } from "shared/payload";

import { Counts } from "src/components/guide/LineCount";
import { lineCounts, splitPath } from "src/components/guide/visible";
import { useTickedCount } from "src/store/ticks.store";
import { useViewStore } from "src/store/view.store";
import { cardElementId } from "src/utils/anchors";
import { cn } from "src/utils/cn";

const smooth = (): ScrollBehavior => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

// Opens a card, even a ticked one, and brings its top into view, as the template's file list does.
export function openCard(element: HTMLElement | null) {
  const body = element?.querySelector(":scope > details");
  if (body instanceof HTMLDetailsElement) {
    body.open = true;
  }
  element?.scrollIntoView({ block: "start", behavior: smooth() });
}

// One row of a section's file list, or of the Diff tab's: name, folder, counts, ticked when its card is.
export function FileItem({
  layer,
  file,
  hunkIds,
  section,
  keys,
}: {
  layer: number;
  file: ReviewFile;
  hunkIds?: string[];
  section?: number;
  keys: string[];
}) {
  const done = useTickedCount(keys) === keys.length && keys.length > 0;
  const setAnchor = useViewStore(state => state.setAnchor);
  const { add, del } = lineCounts(file, hunkIds);
  const { name, dir } = splitPath(file.path);
  return (
    <li>
      <button
        type="button"
        title={file.path}
        onClick={() => {
          // Its first hunk rather than the file, so a file split across sections links to this section's card.
          setAnchor(hunkIds?.[0] ?? file.id);
          openCard(document.getElementById(cardElementId(layer, file.id, section)));
        }}
        className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 rounded-md border bg-card px-2.5 py-1.5 text-left text-[13px] hover:border-ring"
      >
        <span className="truncate">
          {done && (
            <span className="text-success">
              <span className="sr-only">Reviewed: </span>✓{" "}
            </span>
          )}
          <span
            className={cn(
              "font-medium",
              file.status === "added" && "text-success",
              file.status === "deleted" && "line-through",
              done && "text-muted-foreground",
            )}
          >
            {name}
          </span>
          {dir && <span className="ml-1.5 text-muted-foreground text-xs">{dir}</span>}
        </span>
        <Counts add={add} del={del} />
      </button>
    </li>
  );
}
