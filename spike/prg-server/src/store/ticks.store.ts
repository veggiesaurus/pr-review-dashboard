import type { Layer } from "shared/payload";
import { prKey, TICK_PREFIX } from "shared/ticks";
import { formattingOnly } from "src/components/guide/visible";
import { useLayer } from "src/queries/review.query";
import { useTicks } from "src/queries/ticks.query";
import { useViewStore } from "src/store/view.store";
import { indexLayer } from "src/utils/payload";

// The template's keys: by the PR, then by the file and what its shown hunks change, not where they sit, so a
// rebuild keeps a tick where the code didn't change and drops it where it did.
export function tickKey(layer: Layer, fileId: string, hunkIds?: string[]) {
  const index = indexLayer(layer);
  const file = index.files.get(fileId);
  const ids = hunkIds ?? file?.hunks.map(hunk => hunk.id) ?? [];
  return `${TICK_PREFIX}${prKey(layer.meta)}:${file?.path ?? fileId}:${ids.map(id => index.hunks.get(id)?.hunk.sig || id).join(",")}`;
}

// A whole file, as the Diff tab shows it, is every part the sections hold, so a tick in either tab shows in the
// other. A formatting part is left out while formatting is hidden.
export function cardTickKeys(layer: Layer, fileId: string, hunkIds: string[] | undefined, formatting: boolean) {
  if (hunkIds) {
    return [tickKey(layer, fileId, hunkIds)];
  }
  const parts = layer.sections.flatMap(section =>
    section.files.filter(part => part.id === fileId).map(part => ({ hunks: part.hunks, fmt: section.kind === "formatting" })),
  );
  const kept = formatting ? parts : parts.filter(part => !part.fmt);
  const used = kept.length ? kept : parts;
  return used.length ? used.map(part => tickKey(layer, fileId, part.hunks)) : [tickKey(layer, fileId)];
}

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
