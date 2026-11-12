import type { Layer } from "shared/payload";
import { prKey, TICK_PREFIX } from "shared/ticks";
import { indexLayer } from "src/utils/payload";

// The template's keys: by the PR, then by the file and what its shown hunks change, not where they sit, so a
// rebuild keeps a tick where the code didn't change and drops it where it did.
export function tickKey(layer: Layer, fileId: string, hunkIds?: string[]) {
  const index = indexLayer(layer);
  const file = index.files.get(fileId);
  const ids = hunkIds ?? file?.hunks.map(hunk => hunk.id) ?? [];
  return `${TICK_PREFIX}${prKey(layer.meta)}:${file?.path ?? fileId}:${ids.map(id => index.hunks.get(id)?.hunk.sig || id).join(",")}`;
}

// The hunks of a card that are new since it was ticked: a tick of this file names code the diff no longer has,
// so what was reviewed changed. Empty when the card is ticked now, was never ticked, or only lost hunks.
export function changedSinceTick(
  layer: Layer,
  fileId: string,
  parts: (string[] | undefined)[],
  saved: Iterable<string>,
  ticked: (key: string) => boolean,
): Set<string> {
  const file = indexLayer(layer).files.get(fileId);
  const prefix = tickKey(layer, fileId, []);
  const now = new Set(file?.hunks.map(hunk => hunk.sig));
  const old = [...saved].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length).split(","));
  const stale = old.filter(sigs => sigs.some(sig => !now.has(sig)));
  const seen = new Set(old.flat());
  const changed = new Set<string>();
  for (const part of parts) {
    const hunks = (file?.hunks ?? []).filter(hunk => !part || part.includes(hunk.id));
    // The stale tick was this part's when it shares a hunk with it. When nothing it named is left, it could have been
    // any part's, so only the hunks new since the last build count.
    const shares = stale.some(sigs => hunks.some(hunk => sigs.includes(hunk.sig)));
    const orphan = stale.some(sigs => sigs.every(sig => !now.has(sig)));
    if ((shares || orphan) && !ticked(tickKey(layer, fileId, part))) {
      for (const hunk of hunks) {
        if (!seen.has(hunk.sig) && (shares || hunk.fresh || !layer.meta.lastPass)) {
          changed.add(hunk.id);
        }
      }
    }
  }
  return changed;
}
