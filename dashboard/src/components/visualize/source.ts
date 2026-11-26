// What a diagram's source may mark, which the page colours from the theme rather than the source naming colours. Pure,
// so scripts/diagrams.ts checks a diagram with exactly the text the page renders.

export const MARKS = ["added", "changed", "removed"] as const;
export type Mark = (typeof MARKS)[number];
export type Rgb = [number, number, number];
export type MarkColours = Record<Mark, { fill: Rgb; stroke: Rgb }>;

export const KINDS = {
  sequenceDiagram: "Sequence",
  flowchart: "Flow",
  graph: "Flow",
  stateDiagram: "State",
  "stateDiagram-v2": "State",
  classDiagram: "Class",
  erDiagram: "Data model",
} as const;
export type Kind = keyof typeof KINDS;

export const diagramKind = (source: string): Kind | null => {
  const word = source.trimStart().split(/\s/, 1)[0] ?? "";
  return word in KINDS ? (word as Kind) : null;
};

const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map(n => n.toString(16).padStart(2, "0")).join("")}`;
const RECT = /^(\s*)rect\s+(added|changed|removed)\s*$/gm;

// A sequence diagram marks a run of steps with `rect changed ... end`; the others take `class A,B changed` or
// `A:::changed`, against classDefs added here. classDef splits its styles on commas, so its colours are hex.
export function prepare(source: string, colours: MarkColours): string {
  const kind = diagramKind(source);
  if (kind === "sequenceDiagram") {
    return source.replace(RECT, (_, indent: string, mark: Mark) => `${indent}rect rgb(${colours[mark].fill.join(", ")})`);
  }
  if (kind === null) {
    return source;
  }
  const defs = MARKS.map(mark => {
    const { fill, stroke } = colours[mark];
    return `  classDef ${mark} fill:${hex(fill)},stroke:${hex(stroke)},stroke-width:2px${mark === "removed" ? ",stroke-dasharray:5 3" : ""}`;
  });
  return `${source.trimEnd()}\n${defs.join("\n")}`;
}

// The marks a diagram uses, for its legend.
export const marksIn = (source: string) =>
  MARKS.filter(mark => new RegExp(`^\\s*rect\\s+${mark}\\s*$|:::${mark}\\b|^\\s*(class|cssClass)\\s.*\\b${mark}\\b`, "m").test(source));
