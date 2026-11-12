import { createContext, useContext } from "react";
import type { LocalEdit } from "shared/local";
import type { Annotation, Layer, ReviewFile, Tell } from "shared/payload";

// What every row of one card needs and that changes only with the payload or the view.
export type DiffContextValue = {
  layer: Layer;
  file: ReviewFile;
  split: boolean;
  // Columns a full-width row spans: number, sign and code, once or twice.
  cols: number;
  language: string | null;
  formatting: boolean;
  // The section index of a guide card; undefined in the Diff tab.
  section: number | undefined;
  // Flags and CI annotations by line, "R12" or "L3".
  tells: Map<string, Tell[]>;
  annotations: Map<string, { annotation: Annotation; index: number }[]>;
  // Where the checkout's code differs from what was reviewed, each place previewed by itself.
  local: {
    // The head line that carries an edit's preview button: the first it changes, or the one it comes after.
    marks: Map<number, LocalEdit>;
    // Edits being previewed, by the "R12" they are drawn under, and the head lines they stand in for meanwhile.
    shown: Map<string, LocalEdit[]>;
    hidden: Set<number>;
    toggle: (edit: LocalEdit) => void;
    // Asks to put the reviewed code back in the checkout at an edit.
    revert: (edit: LocalEdit) => void;
  };
};

export const DiffContext = createContext<DiffContextValue | null>(null);

export function useDiff() {
  const value = useContext(DiffContext);
  if (!value) {
    throw new Error("diff rows need a DiffContext");
  }
  return value;
}
