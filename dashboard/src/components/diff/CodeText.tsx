import { Fragment, type ReactNode } from "react";
import type { Range, Segment } from "src/utils/diff";

function nest(classes: string[], text: string, depth = 0): ReactNode {
  const className = classes[depth];
  return className === undefined ? text : <span className={className}>{nest(classes, text, depth + 1)}</span>;
}

// A line's code: highlighted segments when there are any, with the changed words marked.
export function CodeText({ text, segments, marks }: { text: string; segments?: Segment[] | null; marks?: Range[] | null }) {
  if (!segments && !marks?.length) {
    return text;
  }
  const out: ReactNode[] = [];
  let at = 0;
  for (const segment of segments ?? [{ text, classes: [] }]) {
    let start = 0;
    while (start < segment.text.length) {
      const here = at + start;
      const inside = marks?.find(([s, e]) => s <= here && here < e);
      const next = inside ? inside[1] : (marks?.find(([s]) => s > here)?.[0] ?? Number.POSITIVE_INFINITY);
      const end = Math.min(segment.text.length, next - at);
      const piece = nest(segment.classes, segment.text.slice(start, end));
      out.push(inside ? <mark key={here}>{piece}</mark> : <Fragment key={here}>{piece}</Fragment>);
      start = end;
    }
    at += segment.text.length;
  }
  return out;
}
