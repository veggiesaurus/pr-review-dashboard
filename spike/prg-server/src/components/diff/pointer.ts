import { USAGE_QUERY } from "shared/usage";

// Words highlight.js marks as keywords, literals, strings and the like are never names worth looking up.
const NOT_NAMES = ".hljs-keyword, .hljs-built_in, .hljs-literal, .hljs-string, .hljs-comment, .hljs-number, .hljs-regexp, .hljs-meta";
const WORD = /[\w$]/;

// The hunk and line a cell with data-line belongs to.
export function lineOf(cell: HTMLElement) {
  const { hunk, line } = cell.dataset;
  if (!hunk || !line) {
    return null;
  }
  return { hunk, side: line.startsWith("L") ? ("L" as const) : ("R" as const), n: Number(line.slice(1)) };
}

function caretAt(x: number, y: number): [Node | null, number] {
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    return [position?.offsetNode ?? null, position?.offset ?? 0];
  }
  const range = document.caretRangeFromPoint?.(x, y);
  return [range?.startContainer ?? null, range?.startOffset ?? 0];
}

// The identifier under the pointer in a code cell, as text and as a range to underline, or null.
export function identifierAt(cell: HTMLElement, x: number, y: number): { word: string; range: Range } | null {
  const [node, offset] = caretAt(x, y);
  if (!(node instanceof Text) || !cell.contains(node)) {
    return null;
  }
  const text = node.data;
  let start = offset;
  let end = offset;
  while (start > 0 && WORD.test(text[start - 1] ?? "")) {
    start--;
  }
  while (end < text.length && WORD.test(text[end] ?? "")) {
    end++;
  }
  const word = text.slice(start, end);
  const skip = node.parentElement?.closest(NOT_NAMES);
  if (!USAGE_QUERY.test(word) || (skip && cell.contains(skip))) {
    return null;
  }
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const rect = range.getBoundingClientRect();
  return x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1 ? { word, range } : null;
}

// A text selection that runs across two or more lines on one side of one hunk, with where to offer a note on them
// relative to the wrapper.
export function rangeFromSelection(wrap: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const cellOf = (node: Node | null) =>
    (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("td[data-line]") ?? null;
  const a = cellOf(selection.anchorNode);
  const b = cellOf(selection.focusNode);
  const la = a && wrap.contains(a) ? lineOf(a) : null;
  const lb = b && wrap.contains(b) ? lineOf(b) : null;
  if (!la || !lb || la.hunk !== lb.hunk || la.side !== lb.side || la.n === lb.n) {
    return null;
  }
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const box = wrap.getBoundingClientRect();
  return {
    hunk: la.hunk,
    side: la.side,
    from: Math.min(la.n, lb.n),
    to: Math.max(la.n, lb.n),
    top: rect.bottom - box.top + 4,
    left: Math.max(0, Math.min(rect.right - box.left + wrap.scrollLeft, wrap.scrollWidth - 180)),
  };
}
