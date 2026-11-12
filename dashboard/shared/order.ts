import type { ResolvedAnchor } from "./messages";
import type { Hunk, Layer } from "./payload";

// Where a hunk's row for this line is drawn; an unchanged line outside it goes before or after it.
function rowIn(hunk: Hunk, side: "L" | "R", line: number) {
  const at = hunk.lines.findIndex(([sign, oldNo, newNo]) =>
    side === "L" ? sign === "-" && oldNo === line : sign !== "-" && newNo === line,
  );
  if (at >= 0) {
    return at;
  }
  const first = hunk.lines.find(row => row[0] !== "-")?.[2] ?? hunk.newStart;
  return line < first ? line - 1e9 : line + 1e9;
}

// Notes in the order the Guide draws them, as the skill's page lists them: bottom layer first, sections in order, each
// hunk's rows as the unified layout draws them; then notes not on the code, and last those a rebuild took away.
export function noteOrder(layers: Layer[]) {
  const layerAt = new Map(layers.map((layer, i) => [layer.id, i]));
  const hunkAt = new Map<string, number>();
  const fileAt = new Map<string, number>();
  for (const layer of layers) {
    let next = 0;
    const place = (file: string, hunk: string | null) => {
      const key = `${layer.id}:${hunk}`;
      if (hunk !== null && !hunkAt.has(key)) {
        hunkAt.set(key, next++);
      }
      if (!fileAt.has(`${layer.id}:${file}`)) {
        fileAt.set(`${layer.id}:${file}`, hunk === null ? next++ : (hunkAt.get(key) ?? next));
      }
    };
    const files = new Map(layer.files.map(file => [file.id, file]));
    for (const part of layer.sections.flatMap(section => section.files)) {
      for (const hunk of files.get(part.id)?.hunks ?? []) {
        if (part.hunks.includes(hunk.id)) {
          place(part.id, hunk.id);
        }
      }
    }
    for (const file of [...layer.files].sort((a, b) => a.path.localeCompare(b.path))) {
      for (const hunk of file.hunks) {
        place(file.id, hunk.id);
      }
      place(file.id, null);
    }
  }

  const rank = (anchor: ResolvedAnchor): number[] => {
    const layer = "layer" in anchor && anchor.layer !== undefined ? (layerAt.get(anchor.layer) ?? 999) : 999;
    const head = [anchor.outdated ? 1 : 0, layer];
    const shown = layers.find(l => l.id === (anchor as { layer?: number }).layer);
    const hunkOf = (id: string) => shown?.files.flatMap(file => file.hunks).find(hunk => hunk.id === id);
    if (anchor.kind === "line" || anchor.kind === "tell") {
      const side = anchor.kind === "line" ? anchor.side : anchor.line[0] === "L" ? "L" : "R";
      const line = anchor.kind === "line" ? anchor.line : Number(anchor.line.slice(1));
      const id = anchor.kind === "line" ? anchor.hunk : shown?.tells.find(t => t.file === anchor.file && t.line === anchor.line)?.hunk;
      const hunk = id ? hunkOf(id) : undefined;
      if (hunk) {
        return [...head, 0, hunkAt.get(`${anchor.layer}:${hunk.id}`) ?? 1e9, rowIn(hunk, side, line)];
      }
    }
    if (anchor.kind === "hunk") {
      return [...head, 0, hunkAt.get(`${anchor.layer}:${anchor.hunk}`) ?? 1e9, -2e9];
    }
    if ("file" in anchor) {
      return [...head, 0, fileAt.get(`${anchor.layer}:${anchor.file}`) ?? 1e9, -3e9];
    }
    return [...head, 1, 0, 0];
  };

  return (a: ResolvedAnchor, b: ResolvedAnchor) => {
    const [x, y] = [rank(a), rank(b)];
    const at = x.findIndex((value, i) => value !== y[i]);
    return at < 0 ? 0 : (x[at] ?? 0) - (y[at] ?? 0);
  };
}
