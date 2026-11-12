import type { Layer } from "shared/payload";
import { formattingOnly } from "src/components/guide/visible";
import { useLayer } from "src/queries/review.query";
import { useSavedTicks, useTicks } from "src/queries/ticks.query";
import { useViewStore } from "src/store/view.store";
import { changedSinceTick, tickKey } from "src/utils/ticks";

export { tickKey };

// A whole file, as the Diff tab shows it, is every part the sections hold, so a tick in either tab shows in the
// other. A formatting part is left out while formatting is hidden.
function cardParts(layer: Layer, fileId: string, hunkIds: string[] | undefined, formatting: boolean): (string[] | undefined)[] {
  if (hunkIds) {
    return [hunkIds];
  }
  const parts = layer.sections.flatMap(section =>
    section.files.filter(part => part.id === fileId).map(part => ({ hunks: part.hunks, fmt: section.kind === "formatting" })),
  );
  const kept = formatting ? parts : parts.filter(part => !part.fmt);
  const used = kept.length ? kept : parts;
  return used.length ? used.map(part => part.hunks) : [undefined];
}

export const cardTickKeys = (layer: Layer, fileId: string, hunkIds: string[] | undefined, formatting: boolean) =>
  cardParts(layer, fileId, hunkIds, formatting).map(part => tickKey(layer, fileId, part));

export const sectionTickKeys = (layer: Layer, index: number) =>
  (layer.sections[index]?.files ?? []).map(part => tickKey(layer, part.id, part.hunks));

// The template counts the guide sections' cards. Without sections (render.py failed) it is every file that isn't
// a lock or generated file or formatting only.
export function progressKeys(layer: Layer) {
  if (layer.sections.length) {
    return layer.sections
      .filter(section => section.kind === "guide")
      .flatMap(section => section.files.map(part => tickKey(layer, part.id, part.hunks)));
  }
  return layer.files.filter(file => !file.noise && !formattingOnly(file)).map(file => tickKey(layer, file.id));
}

// How many of these keys are ticked.
export function useTickedCount(keys: string[]) {
  const ticked = useTicks();
  return keys.filter(ticked).length;
}

// Whether a card is ticked (every part behind it, for a whole file), for whatever draws the card.
export function useCardDone(layer: number, file: string, hunkIds?: string[]) {
  const shown = useLayer(layer);
  const formatting = useViewStore(state => state.formatting);
  const keys = shown ? cardTickKeys(shown, file, hunkIds, formatting) : [];
  return useTickedCount(keys) === keys.length && keys.length > 0;
}

const UNCHANGED: ReadonlySet<string> = new Set();

// The hunks of a card that changed after it was ticked, for whatever draws the card.
export function useChangedSinceTick(layer: number, file: string, hunkIds?: string[]): ReadonlySet<string> {
  const shown = useLayer(layer);
  const formatting = useViewStore(state => state.formatting);
  const saved = useSavedTicks();
  const ticked = useTicks();
  const changed = shown ? changedSinceTick(shown, file, cardParts(shown, file, hunkIds, formatting), saved, ticked) : UNCHANGED;
  return changed.size ? changed : UNCHANGED;
}
