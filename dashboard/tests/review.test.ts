import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bruBlocks, loadReview } from "../server/load";
import type { Push } from "../shared/messages";
import type { ReviewResponse } from "../shared/payload";
import { loaded, rawReview, setup } from "./helpers";

const SCRIPTS = resolve(import.meta.dirname, "../../skills/pr-review-dashboard/scripts");

describe("the review", () => {
  test("the session reloads the review from disk, the page hears of it, and the whole file stays on the server", async () => {
    const next = structuredClone(rawReview);
    next.meta.title = "second pass";
    const { store, session, page } = setup({ load: async () => loaded(next) });
    const pushes: Push[] = [];
    store.addPageSink(push => pushes.push(push));

    const response = await session("/api/reload", { method: "POST" });
    expect(await response.json()).toEqual({ ok: true, layers: 1, files: 1, renderError: null });
    expect(pushes).toContainEqual({ type: "review" });

    const body = (await (await page("/api/review")).json()) as ReviewResponse;
    expect(body.layers[0]?.meta.title).toBe("second pass");
    expect(body.layers[0]?.files[0]).not.toHaveProperty("newText");
    expect(body.layers[0]?.files[0]?.lineCount).toBe(3);
    expect(body.layers[0]).toMatchObject({ id: 12, issueKeys: ["ABC-12"], capabilities: { github: true, usages: true } });
  });

  test("a failed reload keeps the review it had and says why", async () => {
    const { session, page } = setup({
      load: async () => {
        throw new Error("hunks.json unreadable");
      },
    });
    const response = await session("/api/reload", { method: "POST" });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "hunks.json unreadable" });
    expect(((await (await page("/api/review")).json()) as ReviewResponse).layers[0]?.meta.title).toBe(rawReview.meta.title);
  });

  test("unchanged lines come from the server's copy of the new file, within its bounds", async () => {
    const { page } = setup();
    expect(await (await page("/api/layers/12/files/f1/lines?from=2&to=9")).json()).toEqual({
      from: 2,
      to: 3,
      lines: ["  return title.trim().toLowerCase();", "}"],
    });
    for (const query of ["from=0&to=2", "from=3&to=2", "from=a&to=2", "from=4&to=9", "from=1&to=3000"]) {
      expect((await page(`/api/layers/12/files/f1/lines?${query}`)).status).toBe(400);
    }
    expect((await page("/api/layers/12/files/f9/lines?from=1&to=2")).status).toBe(404);
    expect((await page("/api/layers/13/files/f1/lines?from=1&to=2")).status).toBe(404);
  });

  test("render.py builds the sections, and without a guide the diff still loads with its message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prg-load-"));
    const hunks = {
      meta: { repo: "acme/shop", number: 12, title: "t", head: "h", headSha: "a".repeat(40) },
      stats: { reviewable: 2 },
      files: [
        {
          id: "f1",
          path: "api/get.bru",
          status: "modified",
          category: "implementation",
          noise: false,
          newText: ["get {", "  url: x", "}", "tests {", "  ok", ""],
          hunks: [
            {
              id: "f1h1",
              noise: null,
              oldStart: 2,
              newStart: 2,
              lines: [
                ["-", 2, null, "  url: y"],
                ["+", null, 2, "  url: x"],
              ],
            },
          ],
        },
      ],
    };
    writeFileSync(join(dir, "hunks.json"), JSON.stringify(hunks));

    const bare = await loadReview(dir, SCRIPTS);
    expect(bare.response.renderError).toContain("guide.json");
    expect(bare.response.layers[0]?.sections).toEqual([]);
    expect(bare.response.layers[0]?.files[0]?.hunks).toHaveLength(1);

    writeFileSync(
      join(dir, "guide.json"),
      JSON.stringify({ sections: [{ title: "Point at x", why: "[x](f1h1)", how: "h", items: ["f1"] }] }),
    );
    const built = await loadReview(dir, SCRIPTS);
    expect(built.response.renderError).toBeNull();
    expect(built.response.layers[0]?.sections).toMatchObject([
      { kind: "guide", title: "Point at x", files: [{ id: "f1", hunks: ["f1h1"] }] },
    ]);
    expect(built.response.layers[0]).not.toHaveProperty("_split");
    expect(built.response.layers[0]?.files[0]).toMatchObject({
      lineCount: 5,
      bruBlocks: [
        { name: "get", open: 1, close: 3 },
        { name: "tests", open: 4, close: 6 },
      ],
    });
    expect(built.texts.get("12:f1")?.[1]).toBe("  url: x");
  });

  test("a stack keeps its layers bottom first, each by its PR number", () => {
    const top = structuredClone(rawReview);
    top.meta.number = 13;
    const { response } = loaded({
      stack: {
        repo: "acme/shop",
        focus: 13,
        layers: [
          { number: 12, dir: "12" },
          { number: 13, dir: "13" },
        ],
      },
      layers: [rawReview, top],
    });
    expect(response.layers.map(layer => layer.id)).toEqual([12, 13]);
    expect(response.stack).toMatchObject({ repo: "acme/shop", focus: 13, links: [], churn: [] });
    expect(() => loaded({ stack: { repo: "acme/shop", layers: [{ number: 12, dir: "12" }] }, layers: [rawReview, rawReview] })).toThrow();
  });

  test("a .bru line's block is the one opened above it, so a brace inside a body doesn't count", () => {
    expect(bruBlocks(["meta {", "  name: x", "}", "body:json {", "  {", '    "a": 1', "  }", "}", "docs {", "  more"])).toEqual([
      { name: "meta", open: 1, close: 3 },
      { name: "body:json", open: 4, close: 8 },
      { name: "docs", open: 9, close: 10 },
    ]);
  });
});
