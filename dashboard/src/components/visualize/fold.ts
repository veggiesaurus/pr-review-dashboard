// Sequence diagram folding, from the artifact-sequence-diagrams skill: a folded body becomes a placeholder note (mermaid
// can't draw an empty block) that is cut out of the SVG. It reads mermaid's class names, which is why mermaid is pinned.

const FOLDABLE = /^\s*(loop|alt|opt|par|break|critical)\b\s*(.*)$/;
// Blocks that end with `end` but don't fold.
const PLAIN = /^\s*(rect|box)\b/;
const BRANCH = /^\s*(else|and|option)\b\s*(.*)$/;
const MESSAGE = /^\s*(\w+)\s*<?-{1,2}[>x)]{1,2}[+-]?\s*(\w+)\s*:/;
const NOTE = /^\s*Note\s+(?:over|left of|right of)\s+([\w ,]+):/i;
const PARTICIPANT = /^\s*(?:participant|actor)\s+(\w+)/;

export type Section = { start: number; end: number; label: string; block: Block; actors: Set<string>; ordinal: number };
export type Block = { start: number; end: number; kind: string; label: string; actors: Set<string>; ordinal: number; sections: Section[] };
export type Model = { lines: string[]; order: string[]; blocks: Block[] };
// What is folded, by ordinal, so it outlives a model parsed again from the same source.
export type Folds = { blocks: number[]; sections: number[] };
export const NONE: Folds = { blocks: [], sections: [] };

export function parse(src: string): Model {
  const lines = src.split("\n");
  const order: string[] = [];
  const blocks: Block[] = [];
  const stack: (Block | null)[] = [];
  let ordinal = 0;
  const section = (start: number, label: string, block: Block): Section => ({
    start,
    end: -1,
    label,
    block,
    actors: new Set(),
    ordinal: ordinal++,
  });
  const seen = (name: string) => {
    if (!order.includes(name)) {
      order.push(name);
    }
  };
  lines.forEach((line, index) => {
    const declared = PARTICIPANT.exec(line);
    if (declared?.[1]) {
      seen(declared[1]);
    }
    const opened = FOLDABLE.exec(line);
    if (opened) {
      const label = (opened[2] ?? "").trim();
      const block: Block = { start: index, end: -1, kind: opened[1] ?? "", label, actors: new Set(), ordinal: ordinal++, sections: [] };
      block.sections.push(section(index, label, block));
      blocks.push(block);
      stack.push(block);
      return;
    }
    if (PLAIN.test(line)) {
      stack.push(null);
      return;
    }
    const top = stack.at(-1);
    const branch = BRANCH.exec(line);
    if (branch && top) {
      const last = top.sections.at(-1);
      if (last) {
        last.end = index - 1;
      }
      top.sections.push(section(index, (branch[2] ?? "").trim(), top));
      return;
    }
    if (/^\s*end\s*$/.test(line) && stack.length) {
      const closed = stack.pop();
      const last = closed?.sections.at(-1);
      if (closed && last) {
        last.end = index - 1;
        closed.end = index;
      }
      return;
    }
    const used: string[] = [];
    const message = MESSAGE.exec(line);
    if (message?.[1] && message[2]) {
      used.push(message[1], message[2]);
    }
    const note = NOTE.exec(line);
    if (note?.[1]) {
      used.push(...note[1].split(",").map(name => name.trim()));
    }
    used.forEach(seen);
    for (const block of stack) {
      for (const name of used) {
        block?.actors.add(name);
        block?.sections.at(-1)?.actors.add(name);
      }
    }
  });
  return { lines, order, blocks: blocks.filter(block => block.end > block.start) };
}

const placeholder = (ordinal: number) => `xfold${ordinal}`;
const steps = (count: number) => `${count} ${count === 1 ? "step" : "steps"}`;
// Steps are messages and notes, not the alt, else and end lines around them.
const stepsBetween = (model: Model, from: number, to: number) =>
  model.lines.slice(from + 1, to + 1).filter(line => MESSAGE.test(line) || NOTE.test(line)).length;
const blockCount = (model: Model, block: Block) =>
  block.sections.length > 1 ? `${block.sections.length} cases` : steps(stepsBetween(model, block.start, block.end - 1));

function noteLine(model: Model, indent: string, actors: Set<string>, text: string) {
  const names = model.order.filter(name => actors.has(name));
  const span = names.length > 1 ? `${names[0]},${names.at(-1)}` : (names[0] ?? model.order[0]);
  return `${indent}Note over ${span}: ${text}`;
}

export function foldedSource(model: Model, folds: Folds) {
  const blocks = new Set(folds.blocks);
  const sections = new Set(folds.sections);
  const out: string[] = [];
  let skipUntil = -1;
  model.lines.forEach((line, index) => {
    if (index <= skipUntil) {
      return;
    }
    const indent = /^\s*/.exec(line)?.[0] ?? "";
    const block = model.blocks.find(candidate => candidate.start === index);
    if (block && blocks.has(block.ordinal)) {
      out.push(
        line,
        noteLine(model, `${indent}  `, block.actors.size ? block.actors : new Set(model.order), placeholder(block.ordinal)),
        `${indent}end`,
      );
      skipUntil = block.end;
      return;
    }
    out.push(line);
    const part = model.blocks.flatMap(candidate => candidate.sections).find(candidate => candidate.start === index);
    if (part && sections.has(part.ordinal) && part.end > part.start) {
      out.push(noteLine(model, `${indent}  `, part.actors.size ? part.actors : new Set(model.order), placeholder(part.ordinal)));
      skipUntil = part.end;
    }
  });
  return out.join("\n");
}

// The outermost blocks, which Fold all folds.
export const outermost = (model: Model) =>
  model.blocks
    .filter(block => !model.blocks.some(outer => outer !== block && outer.start < block.start && outer.end > block.end))
    .map(block => block.ordinal);

// The section headings mermaid will draw, in source order: nothing inside a folded body, only the first heading of a
// folded block.
function renderedSections(model: Model, folds: Folds) {
  const hidden: [number, number][] = [];
  for (const block of model.blocks) {
    if (folds.blocks.includes(block.ordinal)) {
      hidden.push([block.start, block.end]);
    }
    for (const part of block.sections) {
      if (folds.sections.includes(part.ordinal)) {
        hidden.push([part.start, part.end]);
      }
    }
  }
  const inside = (line: number) => hidden.some(([from, to]) => line > from && line <= to);
  return model.blocks
    .filter(block => !inside(block.start))
    .flatMap(block =>
      folds.blocks.includes(block.ordinal) ? block.sections.slice(0, 1) : block.sections.filter(part => !inside(part.start)),
    )
    .sort((a, b) => a.start - b.start);
}

const TIGHTEN = 6;
const drawn = (svg: SVGSVGElement) =>
  [...svg.querySelectorAll<SVGGraphicsElement>("line, rect, text, polygon, path, circle")].filter(
    node => !node.closest("defs, marker") && !node.parentElement?.closest("text"),
  );

// Top of the first thing drawn below y (a divider, a frame's bottom edge or the next message).
function nextBelow(svg: SVGSVGElement, y: number) {
  let next = Number.POSITIVE_INFINITY;
  for (const node of drawn(svg)) {
    const tops = node instanceof SVGLineElement ? [node.y1.baseVal.value, node.y2.baseVal.value] : [node.getBBox().y];
    for (const top of tops) {
      if (top >= y && top < next) {
        next = top;
      }
    }
  }
  return Number.isFinite(next) ? next : y;
}

// Removes the band [cut, cut + gap): everything below moves up, lines and frames spanning it get shorter.
function collapse(svg: SVGSVGElement, cut: number, gap: number) {
  for (const node of drawn(svg)) {
    if (node instanceof SVGLineElement) {
      for (const end of [node.y1, node.y2]) {
        const y = end.baseVal.value;
        if (y >= cut + gap) {
          end.baseVal.value = y - gap;
        } else if (y > cut) {
          end.baseVal.value = cut;
        }
      }
      continue;
    }
    const box = node.getBBox();
    if (box.y >= cut) {
      node.setAttribute("transform", `translate(0,${-gap}) ${node.getAttribute("transform") ?? ""}`);
    } else if (node instanceof SVGRectElement && box.y + box.height > cut + gap) {
      node.setAttribute("height", String(box.height - gap));
    }
  }
  const view = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  if (view.length === 4 && view[3] !== undefined) {
    view[3] -= gap;
    svg.setAttribute("viewBox", view.join(" "));
  }
  const height = Number.parseFloat(svg.getAttribute("height") ?? "");
  if (height) {
    svg.setAttribute("height", String(height - gap));
  }
}

// A heading wrapped over several lines is one button: every line clicks, the first takes the focus.
function clickable(nodes: SVGTextElement[], label: string, toggle: () => void) {
  nodes.forEach((node, index) => {
    node.classList.add("prg-fold");
    node.addEventListener("click", event => {
      event.stopPropagation();
      toggle();
    });
    if (index > 0) {
      node.setAttribute("aria-hidden", "true");
      return;
    }
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", label);
    node.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });
  });
}

export type Toggle = (kind: keyof Folds, ordinal: number) => void;

type Heading = { label: string; lines: SVGTextElement[]; y: number };
const bare = (text: string) => text.replace(/[\s-]+/g, "");

// Each block's section headings, top to bottom. Mermaid draws the first section's as loopText and each later one's as
// sectionTitle, and wraps a long one over several lines, from the line that opens "[" to the one that closes "]".
function headingsOf(svg: SVGSVGElement) {
  const out: Heading[] = [];
  const groups = new Set([...svg.querySelectorAll("text.loopText, text.sectionTitle")].map(node => node.parentElement));
  for (const group of groups) {
    const lines = [...(group?.querySelectorAll<SVGTextElement>(":scope > text.loopText, :scope > text.sectionTitle") ?? [])];
    let open: Heading | null = null;
    for (const node of lines.sort((a, b) => a.getBBox().y - b.getBBox().y)) {
      const text = (node.textContent ?? "").trim();
      if (!open || text.startsWith("[")) {
        open = { label: "", lines: [], y: node.getBBox().y };
        out.push(open);
      }
      open.lines.push(node);
      open.label = `${open.label} ${text}`.trim();
      if (text.endsWith("]")) {
        open = null;
      }
    }
  }
  return out.sort((a, b) => a.y - b.y);
}

// After mermaid has drawn the folded source: cuts out the placeholders, puts each folded part's size on its heading
// and, given toggle, makes the kind tags and headings fold on click.
export function decorate(svg: SVGSVGElement, model: Model, folds: Folds, toggle?: Toggle) {
  // Headings pair with sections by label and top-to-bottom position, so a repeated label still maps to its own block.
  const byLabel = new Map<string, Heading[]>();
  for (const heading of headingsOf(svg)) {
    const key = bare(heading.label.replace(/^\[|\]$/g, ""));
    byLabel.set(key, [...(byLabel.get(key) ?? []), heading]);
  }
  const headers = new Map<Section, Heading>();
  for (const part of renderedSections(model, folds)) {
    const heading = byLabel.get(bare(part.label))?.shift();
    if (heading) {
      headers.set(part, heading);
    }
  }
  if (toggle) {
    headers.forEach(({ lines }, part) => {
      if (folds.blocks.includes(part.block.ordinal)) {
        clickable(lines, `Unfold ${part.block.kind} ${part.block.label}`, () => toggle("blocks", part.block.ordinal));
      } else if (part.end > part.start) {
        const folded = folds.sections.includes(part.ordinal);
        clickable(lines, `${folded ? "Unfold" : "Fold"} this section`, () => toggle("sections", part.ordinal));
      }
    });
    // The kind tag (alt, loop) shares its block's group with the block's first heading.
    const blockOf = new Map(
      [...headers].filter(([part]) => part.block.sections[0] === part).map(([part, { lines }]) => [lines[0]?.parentElement, part.block]),
    );
    for (const node of svg.querySelectorAll<SVGTextElement>("text.labelText")) {
      const block = blockOf.get(node.parentElement);
      if (block) {
        const verb = folds.blocks.includes(block.ordinal) ? "Unfold" : "Fold";
        clickable([node], `${verb} ${block.kind} ${block.label}`, () => toggle("blocks", block.ordinal));
      }
    }
  }
  const placeholders = [...svg.querySelectorAll("text")]
    .filter(node => /^xfold\d+$/.test((node.textContent ?? "").trim()))
    .flatMap(node => (node.parentElement instanceof SVGGElement ? [node.parentElement] : []))
    .sort((a, b) => b.getBBox().y - a.getBBox().y);
  for (const group of placeholders) {
    const box = group.getBBox();
    group.remove();
    collapse(svg, box.y - TIGHTEN, nextBelow(svg, box.y + box.height) - box.y + TIGHTEN);
  }
  headers.forEach(({ lines }, part) => {
    const text = folds.blocks.includes(part.block.ordinal)
      ? blockCount(model, part.block)
      : folds.sections.includes(part.ordinal)
        ? steps(stepsBetween(model, part.start, part.end))
        : null;
    const header = lines[0];
    const frame = header?.parentElement;
    if (!text || !header || !(frame instanceof SVGGElement)) {
      return;
    }
    const box = frame.getBBox();
    const count = document.createElementNS("http://www.w3.org/2000/svg", "text");
    count.setAttribute("x", String(box.x + box.width - 10));
    count.setAttribute("y", header.getAttribute("y") ?? "0");
    count.setAttribute("text-anchor", "end");
    count.setAttribute("dominant-baseline", header.getAttribute("dominant-baseline") ?? "auto");
    count.setAttribute("class", "prg-fold-count");
    const transform = header.getAttribute("transform");
    if (transform) {
      count.setAttribute("transform", transform);
    }
    count.style.fontSize = getComputedStyle(header).fontSize;
    count.textContent = text;
    frame.appendChild(count);
  });
}
