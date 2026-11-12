import { useMemo, useSyncExternalStore } from "react";

import { FileCard } from "src/components/diff/FileCard";
import { FileItem } from "src/components/guide/FileItem";
import { SIDE, SPLIT_COLUMNS } from "src/components/guide/Guide";
import { plural, shownFiles } from "src/components/guide/visible";
import { Summary } from "src/components/ui/disclosure";
import { useLayer } from "src/queries/review.query";
import { cardTickKeys } from "src/store/ticks.store";
import { useViewStore } from "src/store/view.store";

const WIDE = "(min-width: 861px)";
const subscribe = (change: () => void) => {
  const query = matchMedia(WIDE);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};
const useWide = () => useSyncExternalStore(subscribe, () => matchMedia(WIDE).matches);

// The Diff tab: every file of the layer in path order, with a list to jump from, under the same filter, formatting
// switch and ticks as the Guide. The list folds away on a narrow window.
export function DiffTab({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const show = useViewStore(state => state.show);
  const formatting = useViewStore(state => state.formatting);
  const wide = useWide();
  const files = useMemo(() => (shown ? shownFiles(shown, show, formatting) : []), [shown, show, formatting]);
  if (!shown) {
    return null;
  }
  return (
    <div className={`${SPLIT_COLUMNS} py-6`}>
      <aside className={SIDE}>
        <details key={String(wide)} open={wide} className="group/list motion-expand">
          <Summary className="font-serif text-xl tracking-tight min-[861px]:pointer-events-none min-[861px]:[&>svg]:hidden">
            {plural(files.length, "file")}
          </Summary>
          <p className="mt-1 mb-3 text-muted-foreground text-xs">In path order.</p>
          <ul className="grid gap-1.5" aria-label="Files">
            {files.map(({ file }) => (
              <FileItem key={file.id} layer={layer} file={file} keys={cardTickKeys(shown, file.id, undefined, formatting)} />
            ))}
          </ul>
        </details>
      </aside>
      <div className="grid min-w-0 content-start gap-4">
        {files.length === 0 && <p className="text-muted-foreground text-sm">No file is in this part of the change.</p>}
        {files.map(({ file }) => (
          <FileCard key={file.id} layer={layer} file={file.id} />
        ))}
      </div>
    </div>
  );
}
