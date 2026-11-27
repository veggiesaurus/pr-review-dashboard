// Draws every diagram in a diagrams.json with the page's own mermaid, marks applied as the page applies them, and
// fails on any it can't draw. Usage: bun scripts/diagrams.mjs WORK/diagrams.json
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

import { MARKS, prepare } from "../src/components/visualize/source.ts";

const file = process.argv[2];
if (!file) {
  console.error("usage: bun scripts/diagrams.mjs DIAGRAMS.json");
  process.exit(2);
}
const { diagrams = [] } = JSON.parse(readFileSync(file, "utf8"));
const grey = Object.fromEntries(MARKS.map(mark => [mark, { fill: [220, 220, 220], stroke: [90, 90, 90] }]));

// Playwright's own Chromium when it has been installed, else the machine's Chrome.
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
let failed = 0;
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ path: join(import.meta.dirname, "..", "node_modules", "mermaid", "dist", "mermaid.min.js") });
  for (const [index, diagram] of diagrams.entries()) {
    const problem = await page.evaluate(
      async ({ text, id }) => {
        const { mermaid } = window;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: "base" });
        try {
          const { svg } = await mermaid.render(id, text);
          return svg.includes("NaN") ? "drawn with NaN coordinates" : null;
        } catch (error) {
          return String(error?.message ?? error);
        }
      },
      { text: prepare(String(diagram.source ?? ""), grey), id: `d${index}` },
    );
    failed += problem ? 1 : 0;
    console.log(problem ? `FAIL diagram ${index + 1} (${diagram.title}): ${problem}` : `ok   diagram ${index + 1} (${diagram.title})`);
  }
} finally {
  await browser.close();
}
console.log(`${diagrams.length} diagrams, ${failed ? `${failed} failed` : "all drawn"}`);
process.exit(failed ? 1 : 0);
