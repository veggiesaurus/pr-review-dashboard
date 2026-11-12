import { useEffect, useRef } from "react";

import { useLayer } from "src/queries/review.query";
import { useSetTicks } from "src/queries/ticks.query";
import { cardTickKeys, sectionTickKeys, useTickedCount } from "src/store/ticks.store";
import { useViewStore } from "src/store/view.store";
import { cn } from "src/utils/cn";

// A Reviewed checkbox: for one file card (file, and hunkIds when the card shows part of it) or, without a file, for
// a whole section, which is ticked when every card in it is. The card folds itself on useCardDone.
export function ReviewedTick({
  layer,
  file,
  hunkIds,
  section,
  className,
}: {
  layer: number;
  file?: string;
  hunkIds?: string[];
  section?: number;
  className?: string;
}) {
  const shown = useLayer(layer);
  const formatting = useViewStore(state => state.formatting);
  const setTicks = useSetTicks();
  const box = useRef<HTMLInputElement>(null);
  const keys = !shown
    ? []
    : file
      ? cardTickKeys(shown, file, hunkIds, formatting)
      : section !== undefined
        ? sectionTickKeys(shown, section)
        : [];
  const done = useTickedCount(keys);
  const checked = keys.length > 0 && done === keys.length;
  const partly = done > 0 && !checked;

  useEffect(() => {
    if (box.current) {
      box.current.indeterminate = partly;
    }
  }, [partly]);

  return (
    <label className={cn("inline-flex cursor-pointer select-none items-center gap-1.5 text-muted-foreground text-xs", className)}>
      <input
        ref={box}
        type="checkbox"
        data-tick={file ? "card" : "section"}
        checked={checked}
        disabled={keys.length === 0}
        onChange={event => setTicks(keys, event.target.checked)}
        className="motion-tick accent-primary"
      />
      Reviewed
    </label>
  );
}
