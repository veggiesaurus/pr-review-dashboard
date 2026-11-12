import type { LineAnchor } from "shared/messages";
import type { Hunk, HunkLine } from "shared/payload";

// The anchor a note on this row is pinned to: a removed line by its old number, any other by its new one.
export function lineAnchor(layer: number, file: string, hunk: Hunk, line: HunkLine): LineAnchor | null {
  const [sign, oldNo, newNo] = line;
  const side = sign === "-" ? "L" : "R";
  const number = side === "L" ? oldNo : newNo;
  return number === null ? null : { kind: "line", layer, file, hunk: hunk.id, side, line: number };
}
