import type { Hunk, Layer, ReviewFile, ReviewResponse } from "shared/payload";

export type LayerIndex = {
  files: Map<string, ReviewFile>;
  hunks: Map<string, { file: ReviewFile; hunk: Hunk }>;
  // The section each hunk shows in, by index into layer.sections.
  owner: Map<string, number>;
};

const indexes = new WeakMap<Layer, LayerIndex>();

// Lookups for one layer, built once per payload.
export function indexLayer(layer: Layer): LayerIndex {
  let index = indexes.get(layer);
  if (!index) {
    index = { files: new Map(), hunks: new Map(), owner: new Map() };
    for (const file of layer.files) {
      index.files.set(file.id, file);
      for (const hunk of file.hunks) {
        index.hunks.set(hunk.id, { file, hunk });
      }
    }
    for (const [i, section] of layer.sections.entries()) {
      for (const part of section.files) {
        for (const hunk of part.hunks) {
          index.owner.set(hunk, i);
        }
      }
    }
    indexes.set(layer, index);
  }
  return index;
}

// The issue keys any layer names: the server looks up these and no others.
export const allIssueKeys = (review: ReviewResponse) => [...new Set(review.layers.flatMap(layer => layer.issueKeys))];

// The layer the page opens on: the one the stack was collected from, else the top.
export const defaultLayer = (review: ReviewResponse) => {
  const ids = review.layers.map(layer => layer.id);
  const focus = review.stack?.focus;
  return focus && ids.includes(focus) ? focus : (ids.at(-1) ?? 0);
};

// The browser tab's title, as render.py writes it: "repo#3 guide", "branch guide", or on a stack "repo#12 stack" for
// the layer being read.
export function pageTitle(review: ReviewResponse, layer: Layer) {
  const name = (repo: string | null | undefined) => (repo ?? "").split("/").pop() ?? "";
  if (review.stack) {
    return `${name(review.stack.repo)}#${layer.id} stack`;
  }
  return layer.meta.number ? `${name(layer.meta.repo)}#${layer.meta.number} guide` : `${layer.meta.head} guide`;
}
