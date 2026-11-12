// A full-page screenshot of a running server's page, failing on console errors, page errors and CSP violations.
// Usage: bun tests/shot.mjs STATE OUT_DIR [light|dark] [WIDTH] [HASH], STATE the server's state file, HASH like #12/guide.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

const [state, out, scheme = "light", width = "1400", hash = ""] = process.argv.slice(2);
if (!state || !out || !["light", "dark"].includes(scheme)) {
  console.error("usage: bun tests/shot.mjs STATE OUT_DIR [light|dark] [WIDTH] [HASH]");
  process.exit(2);
}

const { link } = JSON.parse(readFileSync(state, "utf8"));
const problems = [];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: Number(width), height: 900 }, colorScheme: scheme });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", event => {
      console.error(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });
  page.on("pageerror", error => problems.push(`page error: ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error") {
      problems.push(`console: ${message.text()}`);
    }
  });
  await page.goto(`${link}${hash}`);
  await page.waitForSelector("[role=tablist]", { timeout: 15_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  // A viewport as tall as the page keeps the fixed chat bar at the bottom instead of across the middle.
  await page.setViewportSize({ width: Number(width), height: await page.evaluate(() => document.documentElement.scrollHeight) });
  await page.waitForTimeout(300);
  mkdirSync(out, { recursive: true });
  const name = `${hash.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "page"}-${scheme}-${width}.png`;
  await page.screenshot({ path: join(out, name) });
  console.log(join(out, name));
} finally {
  await browser.close();
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
