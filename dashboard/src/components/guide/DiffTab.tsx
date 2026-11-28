import { useMemo } from "react";

import { FileCard } from "src/components/diff/FileCard";
import { useWide } from "src/components/diff/hooks";
import { FileItem } from "src/components/guide/FileItem";
import { plural, shownFiles } from "src/components/guide/visible";
import { Summary } from "src/components/ui/disclosure";
import { useLayer } from "src/queries/review.query";
import { cardTickKeys } from "src/store/ticks.store";
import { useViewStore } from "src/store/view.store";

// Every file of the layer in path order, under the same filter and formatting switch as the sections.
export function FileList({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const show = useViewStore(state => state.show);
  const formatting = useViewStore(state => state.formatting);
  const files = useMemo(() => (shown ? shownFiles(shown, show, formatting) : []), [shown, show, formatting]);
  if (!shown) {
    return null;
  }
  return (
    <ul className="grid gap-1.5" aria-label="Files">
      {files.map(({ file }) => (
        <FileItem key={file.id} layer={layer} file={file} keys={cardTickKeys(shown, file.id, undefined, formatting)} />
      ))}
    </ul>
  );
}

// The Changes view by file. The list to jump from is in the outline on a wide window, and folds above the cards on a
// narrow one.
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
    <div className="grid min-w-0 content-start gap-4 py-6">
      {!wide && (
        <details className="group/list motion-expand">
          <Summary className="font-serif text-xl tracking-tight">{plural(files.length, "file")}</Summary>
          <div className="mt-3">
            <FileList layer={layer} />
          </div>
        </details>
      )}
      {files.length === 0 && <p className="text-muted-foreground text-sm">No file is in this part of the change.</p>}
      {files.map(({ file }) => (
        <FileCard key={file.id} layer={layer} file={file.id} />
      ))}
    </div>
  );
}
