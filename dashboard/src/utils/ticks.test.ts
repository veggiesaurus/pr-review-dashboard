import { describe, expect, test } from "bun:test";
import type { Layer } from "shared/payload";

import { changedSinceTick, tickKey } from "./ticks";

// A layer of one file whose hunks are named by their signatures, some new since the last build.
const layer = (sigs: string[], fresh: string[] = []) =>
  ({
    meta: { repo: "o/r", number: 1, head: "b", lastPass: {} },
    sections: [],
    files: [{ id: "f1", path: "a.ts", hunks: sigs.map(sig => ({ id: `h-${sig}`, sig, fresh: fresh.includes(sig) })) }],
  }) as unknown as Layer;

describe("what changed since a card was ticked", () => {
  const before = layer(["a", "b", "c"]);
  const tickAll = tickKey(before, "f1");
  const tickFirst = tickKey(before, "f1", ["h-a"]);
  const changed = (now: Layer, parts: (string[] | undefined)[], saved: string[]) =>
    [...changedSinceTick(now, "f1", parts, saved, key => saved.includes(key))].join();

  test("a rewritten hunk is the one named, in the card that was ticked", () => {
    expect(changed(layer(["a", "b2", "c"]), [undefined], [tickAll])).toBe("h-b2");
  });

  test("nothing is named while the tick still holds, or when the card was never ticked", () => {
    expect(changed(before, [undefined], [tickAll])).toBe("");
    expect(changed(layer(["a", "b2", "c"]), [undefined], [])).toBe("");
  });

  test("a part nobody ticked stays quiet when another part's tick goes stale", () => {
    const now = layer(["a2", "b", "c"], ["a2"]);
    expect(changed(now, [["h-b", "h-c"]], [tickFirst])).toBe("");
    expect(changed(now, [["h-a2"]], [tickFirst])).toBe("h-a2");
  });

  test("a hunk that only went away leaves nothing to look at", () => {
    expect(changed(layer(["a", "c"]), [undefined], [tickAll])).toBe("");
  });
});
