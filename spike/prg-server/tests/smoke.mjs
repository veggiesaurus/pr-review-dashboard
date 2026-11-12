// The skill's tests/smoke.mjs on the server's page, served from a fresh fixture. Fails on any console error, page error
// or CSP violation. Usage: bun tests/smoke.mjs [STATIC_DIR], STATIC_DIR the built page (default build/).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { chromium } from "playwright";

const here = resolve(import.meta.dirname, "..");
const root = resolve(here, "../..");
const built = resolve(process.argv[2] ?? join(here, "build"));
const tmp = mkdtempSync(join(tmpdir(), "prg-smoke-"));
const fx = join(tmp, "fx");
const servers = [];
const problems = [];
let failures = 0;
let browser;
let page;

const SECTION = "section[data-section]";
const CARD = "article[data-card]";
const NOISE = "td[class*=\"content-['fmt']\"]";
const MOVE_ROW = /lines moved (here )?unchanged (to|from)/;
const NOTE_ID = "[id^='t-m']";
const NOTE = `.prg-diff ${NOTE_ID}`;

async function serve(name, data) {
  const state = join(tmp, `${name}.json`);
  const child = spawn("bun", ["run", "server/index.ts", "--state", state, "--data", data, "--repo", join(fx, "repo"), "--static", built], {
    cwd: here,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const server = { child, state };
  servers.push(server);
  for (let i = 0; i < 150; i++) {
    if (existsSync(state)) {
      try {
        return Object.assign(server, JSON.parse(readFileSync(state, "utf8")));
      } catch {
        // Written but not yet whole.
      }
    }
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(`the server for ${name} didn't start`);
}

// Waits for the exit, since a server still shutting down writes into the folder being removed.
async function stop({ child, origin, token }) {
  if (child.exitCode !== null) {
    return;
  }
  const exited = new Promise(done => child.once("exit", done));
  if (origin && token) {
    await fetch(`${origin}/api/shutdown`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
  child.kill();
  await exited;
}

async function open(link, hash = "") {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
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
  await page.waitForSelector("[role=tablist]");
}

// React draws after the event, so each check looks again for a few seconds before it fails.
async function check(what, probe, ok = Boolean) {
  const until = Date.now() + 4000;
  let seen;
  for (;;) {
    seen = await probe();
    if (ok(seen)) {
      console.log(`ok   ${what}`);
      return;
    }
    if (Date.now() > until) {
      break;
    }
    await page.waitForTimeout(100);
  }
  failures++;
  console.log(`FAIL ${what} (saw ${JSON.stringify(seen)})`);
}

const count = selector => page.locator(selector).count();
const tab = name => page.getByRole("tab", { name, exact: true }).click();
const h1 = () => page.locator("h1").textContent();
const pick = () => page.getByRole("combobox", { name: "Which part of the change to show" });
const choose = async name => {
  await pick().click();
  await page.getByRole("option", { name }).click();
};
const formatting = () => page.getByRole("checkbox", { name: "Formatting" });
const unsplit = () => count(".prg-diff table:not(.table-fixed)");

try {
  const made = spawnSync("python3", [join(root, "tests/fixture.py"), fx], { encoding: "utf8" });
  if (made.status) {
    throw new Error(`fixture.py failed: ${made.stderr}`);
  }
  const work = await serve("work", join(fx, "work"));
  const stack = await serve("stack", join(fx, "stack"));
  browser = await chromium.launch();

  await open(work.link);
  // The ready check's lists are on Overview and its chips in the header on every tab, where the template has both under the header.
  const ready = await page.getByRole("region", { name: "Before you mark it ready" }).textContent();
  for (const want of [
    "Try by hand",
    "What the diff carries out (1)",
    "Not in the diff:",
    "CI annotations",
    "1 on lines this PR doesn't change",
  ]) {
    await check(`ready check has "${want}"`, async () => ready.includes(want));
  }
  await check("the description and issue sections list only where they and the diff disagree", async () => !ready.includes("In the diff:"));
  await check(
    'the header chips have "new since"',
    () => page.locator("header").first().textContent(),
    text => text.includes("new since"),
  );

  // Try by hand is a checklist the server keeps, and a step takes a note, here marked as a nit. Both are undone after.
  const tryBlock = page.getByRole("region", { name: "Before you mark it ready" }).locator("details", { hasText: "Try by hand" });
  const tried = () => tryBlock.locator("summary").textContent();
  await tryBlock.getByRole("checkbox").check();
  await page.reload();
  await check("a ticked step to try stays ticked after a reload", tried, text => text === "Try by hand (1 of 1)");
  await tryBlock.locator("button[data-ask]").click();
  await page.getByRole("textbox", { name: /^Note or question about a thing to try by hand/ }).fill("The old link 404s.");
  await page.getByRole("group", { name: "What the note asks for" }).getByRole("button", { name: "Nit" }).click();
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page.getByRole("button", { name: /^Notes/ }).click();
  // The notes are on Overview as well as in the drawer, which comes last and is the one in reach.
  const labelled = page.locator("li", { hasText: "The old link 404s." }).last();
  await check("a note on a step, marked as a nit, says so in the notes", () => labelled.getByText("Nit", { exact: true }).count());
  await labelled.getByRole("button", { name: "Delete" }).click();
  await check(
    "and deleting it takes it out of the notes",
    () => labelled.count(),
    n => n === 0,
  );
  // A reload puts the drawer back on the review as a whole, where the checks below expect it.
  await page.reload();
  await tryBlock.getByRole("checkbox").uncheck();
  await check("and the step unticks", tried, text => text === "Try by hand (0 of 1)");

  // The template is one page; here the sections are the Guide tab.
  await tab("Guide");
  await page.waitForSelector(SECTION);
  await check(
    "two sections, with the formatting one hidden",
    () => count(SECTION),
    n => n === 2,
  );
  await check(
    "formatting lines inside a hunk show once, as context",
    () => count(NOISE),
    n => n === 0,
  );
  await formatting().check();
  await check(
    "the formatting switch shows them, dimmed, and their section",
    () => Promise.all([count(SECTION), count(NOISE)]),
    ([sections, noise]) => sections === 3 && noise > 0,
  );
  await formatting().uncheck();
  await check(
    "and hides them again",
    () => Promise.all([count(SECTION), count(NOISE)]),
    ([sections, noise]) => sections === 2 && noise === 0,
  );
  await check(
    "a moved block shows where it went and where it came from",
    () => page.locator(".prg-diff tr", { hasText: MOVE_ROW }).count(),
    n => n === 2,
  );
  await check(
    "the moved copy is marked line by line",
    () => count(".prg-diff tr:has(> td.bg-primary\\/8)"),
    n => n === 6,
  );
  const annotation = page.locator(".prg-diff tr", { hasText: "Unexpected string concatenation." });
  await check(
    "the CI annotation on a changed line sits under it",
    async () => {
      const n = await annotation.count();
      return n === 1 ? await annotation.evaluate(row => Boolean(row.previousElementSibling?.querySelector("td[data-line='R4']"))) : n;
    },
    seen => seen === true,
  );

  await pick().click();
  const options = await page.getByRole("option").allInnerTexts();
  await page.keyboard.press("Escape");
  await check(
    "the filter lists the last pass and the four commits that own hunks",
    async () => options,
    list => list.length === 6 && list[1].startsWith("New since"),
  );
  await check(
    "a commit in the filter shows its size and how much of the diff is its",
    async () => options[3],
    text => /\+\d+ −\d+/.test(text) && /\d+ hunks? in \d+ files?/.test(text),
  );
  await choose(/^New since/);
  await check(
    "since the last pass, only the file that changed shows, in its section",
    () => Promise.all([count(CARD), count(SECTION)]),
    ([cards, sections]) => cards === 1 && sections === 1,
  );
  // The second commit: the options are everything, the last pass, then the commits.
  await pick().click();
  await page.getByRole("option").nth(3).click();
  await check(
    "one commit shows only its file",
    async () => [await count(CARD), await page.locator(`${CARD} header span.font-semibold`).allInnerTexts()],
    ([cards, names]) => cards === 1 && names[0] === "posts.ts",
  );
  await page.getByRole("button", { name: "Show everything" }).click();
  const primary = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary"));
  const claude = await primary();
  await page.getByRole("button", { name: /^Theme: / }).click({ modifiers: ["Shift"] });
  await page.getByRole("radio", { name: "Twitter" }).click();
  await check(
    "shift-click on the theme button lists the palettes, and picking one recolours the page",
    async () => (await primary()) !== claude,
  );
  await page.getByRole("radio", { name: "Claude" }).click();
  await check("picking Claude again puts the page's own colours back", async () => (await primary()) === claude);
  await page.keyboard.press("Escape");
  await page.keyboard.press("u");
  await page.getByRole("textbox", { name: "Identifier to search for" }).fill("slugify");
  await page.keyboard.press("Enter");
  await check("u asks where a name is used and lists the lines that use it", () =>
    page.getByRole("dialog", { name: "Where is it used?" }).locator("ul li").count(),
  );
  await page.keyboard.press("Escape");
  await check(
    "Show everything brings every card back",
    () => count(CARD),
    n => n === 5,
  );
  // highlight.js is bundled, so this always runs. Changed words split a token into pieces, so it counts at least one.
  const bru = page.locator(CARD, { hasText: "get-post.bru" }).locator("td.bg-diff-add[data-ident]", { hasText: "Hello World" });
  await check(
    "a .bru test line is highlighted as JavaScript",
    () => bru.locator(".hljs-string").count(),
    n => n >= 1,
  );

  const line = page.locator("td[data-ln][id$='-R5']").first();
  await line.hover();
  await line.getByRole("button", { name: "Note on line 5" }).click();
  await page.getByRole("textbox", { name: /^Note or question about/ }).fill("Why /blog and not /posts?");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  // A note is a draft held by the server until sent, where the template keeps it in the browser.
  await check(
    "a note shows under its line",
    () => count(NOTE),
    n => n === 1,
  );

  await page.getByRole("button", { name: /^Chat/ }).click();
  await page.getByRole("textbox", { name: "Ask Claude about this review" }).fill("Is this safe to merge?");
  await page.keyboard.press("Enter");
  const threadList = page.getByRole("navigation", { name: "Threads with Claude" });
  await threadList.getByRole("button", { name: /Is this safe to merge/ }).click();
  await page.getByRole("button", { name: "Archive this thread" }).click();
  await check(
    "archiving a thread moves it to the Archived list",
    () => threadList.locator("summary").textContent(),
    text => text === "Archived (1)",
  );
  await threadList.locator("summary").click();
  await threadList.getByRole("button", { name: /Is this safe to merge/ }).click();
  await page.getByRole("button", { name: "Unarchive this thread" }).click();
  await check(
    "and unarchiving brings it back",
    () => threadList.locator("summary").count(),
    n => n === 0,
  );
  await page.keyboard.press("Escape");

  // A review asked for from the page. The test plays the session: it hands back two findings and a recommendation.
  await tab("Overview");
  await check("the review button waits, quietly, for the reader's own pass", () => page.getByText("Best after your own read").count());
  await page.getByRole("button", { name: "Review effort" }).click();
  const efforts = await page.getByRole("menuitem").allInnerTexts();
  await check(
    "the menu joined to the review button offers low to xhigh",
    async () => efforts.join(),
    list => list === "low,medium,high,xhigh",
  );
  await page.getByRole("menuitem", { name: "xhigh", exact: true }).click();
  const running = page.getByRole("button", { name: /Review \d+ running/ });
  await check("asking for a review shows it running", () => running.count());
  const reviewNo = Number((await running.textContent()).match(/\d+/)[0]);
  const auth = { Authorization: `Bearer ${work.token}`, "content-type": "application/json" };
  const asSession = (path, body) => fetch(`${work.origin}/api/${path}`, { method: "POST", headers: auth, body: JSON.stringify(body) });
  await asSession(`reviews/${reviewNo}/findings`, {
    findings: [
      {
        file: "src/posts.ts",
        line: 4,
        summary: "The prefix is hard-coded.",
        failure_scenario: "A site under /news links to /blog.",
        recommended: true,
      },
      { file: "src/slug.ts", line: 2, summary: "An empty title gives an empty slug." },
      {
        file: "src/posts.ts",
        line: 4,
        summary: "The slug isn't escaped.",
        recommended: true,
        patch: "-  return prefix + slugify(title);\n+  return prefix + encodeURIComponent(slugify(title));",
      },
    ],
  });
  const messages = await (await fetch(`${work.origin}/api/messages`, { headers: auth })).json();
  const asked = messages.find(m => m.review?.n === reviewNo && m.from === "user");
  await asSession("activity", { replyTo: asked.id, text: "Reading the diff" });
  await asSession("activity", { replyTo: asked.id, text: "Checking the callers" });
  await asSession("replies", { replyTo: asked.id, state: "answered", text: "Act on the first; the second is a nit." });
  const found = page.locator("details", { hasText: "Claude's review (3)" });
  await check(
    "the findings and Claude's recommendation show on the Overview",
    () => found.textContent(),
    text => ["Act on this", "The prefix is hard-coded.", "An empty title", "Act on the first"].every(part => text?.includes(part)),
  );
  await check("the button is free again once Claude has answered", () =>
    page.getByRole("button", { name: "Ask Claude for a review" }).isEnabled(),
  );
  const newest = page.getByRole("button", { name: /^Claude: Act on the first/ });
  await check("Claude's newest answer shows in the bottom bar", () => newest.count());
  await newest.click();
  await check(
    "and leaves it once its thread has been on screen",
    () => page.getByRole("button", { name: /^Claude: / }).count(),
    n => n === 0,
  );
  const steps = page.getByRole("button", { name: "2 steps Claude took" });
  await check("the steps Claude took fold into a line under the request", () => steps.count());
  await steps.click();
  await check("and open to show each one", () => page.getByText("Checking the callers", { exact: true }).count());
  // Claude asks a question with choices; the pick goes back as a follow-up.
  await asSession("replies", {
    replyTo: asked.id,
    text: "One thing first.",
    ask: [{ question: "Fix both?", options: ["Both", "Only the first"] }],
  });
  await page.getByRole("radio", { name: "Only the first" }).check();
  await page.getByRole("button", { name: "Send answer" }).click();
  await check(
    "a question's answer goes back to the thread as the user's follow-up",
    async () => (await (await fetch(`${work.origin}/api/messages`, { headers: auth })).json()).at(-1),
    last => last?.from === "user" && last.text === "Only the first" && last.replyTo === asked.id,
  );
  await check(
    "and the question leaves once it is answered",
    () => page.getByRole("button", { name: "Send answer" }).count(),
    n => n === 0,
  );
  await page.keyboard.press("Escape");
  await found.getByRole("button", { name: "Open this finding's thread" }).first().click();
  await page.getByRole("button", { name: "Fix this", exact: true }).click();
  await check("Fix this sends a follow-up on the finding", () => page.getByText("Fix this.", { exact: true }).count());
  // Where the findings stand: the recommended one not yet asked about goes in one press, and a dismissal says why.
  await page.keyboard.press("Escape");
  await check(
    "the review counts its findings by where they stand",
    () => found.textContent(),
    text => text?.includes("3 open") && text.includes("Fix the recommended (1)"),
  );
  await found.getByRole("button", { name: "Fix the recommended (1)" }).click();
  const finding = async summary =>
    (await (await fetch(`${work.origin}/api/messages`, { headers: auth })).json()).find(m => m.text.startsWith(summary));
  const unescaped = await finding("The slug isn't escaped.");
  await check(
    "Fix the recommended asks for each open recommended finding at once",
    async () => (await (await fetch(`${work.origin}/api/messages`, { headers: auth })).json()).at(-1),
    last => last?.text === "Fix this." && last.replyTo === unescaped.id,
  );
  await asSession("replies", { replyTo: unescaped.id, state: "done", text: "Escaped it." });
  await found.getByRole("button", { name: "Open this finding's thread" }).last().click();
  await check("a finding shows the patch Claude proposes", () => page.getByText("Proposed patch").count());
  await page.keyboard.press("Escape");
  await found.getByRole("button", { name: "Open this finding's thread" }).nth(1).click();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await page.getByRole("menuitem", { name: "False positive" }).click();
  await check(
    "a dismissed finding stays in the review with its reason",
    () => found.textContent(),
    text => text?.includes("1 open, 1 fixed, 1 dismissed") && text.includes("Dismissed: false positive"),
  );
  await page.getByRole("button", { name: `Archive every thread of review ${reviewNo}` }).click();
  await check(
    "archiving a review puts all of its threads away",
    () => found.count(),
    n => n === 0,
  );
  await page.keyboard.press("Escape");
  await tab("Guide");
  await page.waitForSelector(SECTION);

  // The checkout moves on from what was reviewed: one line changed, one added. Each place gets its own preview.
  const posts = join(fx, "repo", "src/posts.ts");
  writeFileSync(posts, `${readFileSync(posts, "utf8").replace("/blog/", "/journal/")}// fixed by the walk\n`);
  await page.reload();
  await page.waitForSelector(SECTION);
  await check(
    "each place the checkout differs gets a preview button on its first line",
    () =>
      page
        .getByRole("button", { name: /^Preview the local code at line/ })
        .evaluateAll(buttons => buttons.map(b => b.getAttribute("aria-label").split(" ").at(-1))),
    lines => lines.join() === "4,5",
  );
  // The reviewed line 4 of posts.ts, as drawn: one code cell while it shows, none while a preview stands in for it.
  const reviewedLine4 = () =>
    page
      .locator(CARD)
      .filter({ has: page.locator("header span.font-semibold", { hasText: /^posts\.ts$/ }) })
      .locator("td[data-line='R4'][data-ident]")
      .count();
  await page.getByRole("button", { name: "Preview the local code at line 4" }).click();
  await check(
    "previewing swaps the checkout's line in for the reviewed one, in its place",
    async () => ({
      local: await page.locator("tr[data-local]").allInnerTexts(),
      reviewed: await reviewedLine4(),
      afterHidden: await page
        .locator("tr[data-local]")
        .first()
        .evaluate(row => row.previousElementSibling?.classList.contains("hidden") ?? false)
        .catch(() => false),
    }),
    seen => seen.local.length === 1 && seen.local[0].includes("/journal/") && seen.reviewed === 0 && seen.afterHidden,
  );
  await page.getByRole("button", { name: "Show the code as reviewed" }).click();
  await check(
    "and its button puts the reviewed line back",
    () => Promise.all([count("tr[data-local]"), reviewedLine4()]),
    ([local, reviewed]) => local === 0 && reviewed === 1,
  );
  await page.getByRole("button", { name: "Preview the local code at line 4" }).click();
  await page.getByRole("button", { name: "Revert this change in your checkout" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revert", exact: true }).click();
  await check(
    "reverting one place puts the reviewed code back in the checkout and leaves the other edit alone",
    async () => ({
      text: readFileSync(posts, "utf8"),
      buttons: await page
        .getByRole("button", { name: /^Preview the local code at line/ })
        .evaluateAll(buttons => buttons.map(b => b.getAttribute("aria-label").split(" ").at(-1))),
    }),
    seen =>
      seen.text.includes("/blog/") &&
      !seen.text.includes("/journal/") &&
      seen.text.includes("// fixed by the walk") &&
      seen.buttons.join() === "5",
  );

  await page.getByRole("button", { name: "Split", exact: true }).click();
  await check("split view draws every diff in two halves", unsplit, n => n === 0);
  await check(
    "the note finds its line again after the redraw",
    () =>
      page
        .locator(`.prg-diff tr:has(${NOTE_ID})`)
        .evaluateAll(rows => rows.map(r => Boolean(r.previousElementSibling?.querySelector("td[data-line='R5']")))),
    rows => rows.length === 1 && rows[0],
  );
  await check("a removed and an added line share a row", () =>
    page
      .locator(".prg-diff tr")
      .evaluateAll(rows => rows.some(r => r.querySelector("td.bg-diff-del") && r.querySelector("td.bg-diff-add"))),
  );
  const removed = () => count(".prg-diff td.bg-diff-del[data-ident]");
  const before = await removed();
  await page.locator(".prg-diff tr", { hasText: MOVE_ROW }).getByRole("button", { name: "Show them" }).first().click();
  await check(
    "the moved-away lines open from their pointer",
    async () => (await removed()) - before,
    n => n === 6,
  );

  await page.locator("input[data-tick='card']").first().check();
  await page.reload();
  await page.waitForSelector(SECTION);
  await check("a tick survives a reload", () => page.locator("input[data-tick='card']").first().isChecked());
  await check("the layout choice survives a reload", unsplit, n => n === 0);
  await page.close();
  // A new page here is a new browser profile, as another device would be.
  await open(work.link);
  await tab("Guide");
  await page.waitForSelector(SECTION);
  await check("a tick shows in another browser", () => page.locator("input[data-tick='card']").first().isChecked());
  // A tick this browser kept before the server did goes up on the next load.
  const [kept] = await (await fetch(`${work.origin}/api/ticks`, { headers: { Authorization: `Bearer ${work.token}` } })).json();
  await page.locator("input[data-tick='card']").first().uncheck();
  await page.evaluate(key => localStorage.setItem(key, "1"), kept);
  await page.reload();
  await page.waitForSelector(SECTION);
  await check(
    "a tick kept in the browser moves to the server",
    async () => [
      await page.locator("input[data-tick='card']").first().isChecked(),
      await page.evaluate(key => localStorage.getItem(key), kept),
    ],
    ([ticked, local]) => ticked && local === null,
  );
  // A tick whose code has since been rewritten: the card says so and marks the hunk that is new.
  const reviewed = await fetch(`${work.origin}/api/review`, { headers: { Authorization: `Bearer ${work.token}` } });
  const rewritten = (await reviewed.json()).layers[0].files.find(file => file.hunks.some(hunk => hunk.fresh));
  const stale = `${kept.split(":").slice(0, 3).join(":")}:${rewritten.path}:a-signature-the-diff-no-longer-has`;
  await page.evaluate(key => localStorage.setItem(key, "1"), stale);
  await page.reload();
  await page.waitForSelector(SECTION);
  await check(
    "a card ticked before its code changed says so",
    () => page.locator(CARD, { hasText: "changed since you ticked" }).locator("header span.font-semibold").allInnerTexts(),
    names => names.length > 0 && names.every(name => rewritten.path.endsWith(name)),
  );
  await page.close();
  console.log("page ok");

  await open(stack.link);
  await check("the stack opens on its top layer", h1, title => title === "layer 12");
  await tab("Guide");
  await page.waitForSelector(SECTION);
  await check(
    "a hunk names what it shares with another layer",
    () => page.locator(".prg-diff tr", { hasText: /(Used further up|Defined further down) the stack:/ }).count(),
    n => n >= 1,
  );
  await page.getByRole("button", { name: "Split", exact: true }).click();
  // The stack panel is on Overview, and only the shown layer is drawn, so split is checked on the layer opened next.
  await tab("Overview");
  await page.getByRole("list", { name: "Layers, top first" }).getByRole("button", { name: /^#11 / }).click();
  await check("a layer opens from the list", h1, title => title === "layer 11");
  await tab("Guide");
  await page.waitForSelector(SECTION);
  await check("split view holds on every layer", unsplit, n => n === 0);
  console.log("stack page ok");
} catch (error) {
  failures++;
  console.log(`FAIL ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser?.close();
  await Promise.all(servers.map(stop));
  rmSync(tmp, { recursive: true, force: true });
}

if (problems.length) {
  console.error(problems.join("\n"));
}
process.exit(failures || problems.length ? 1 : 0);
