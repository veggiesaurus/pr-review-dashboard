// The skill's tests/smoke.mjs on the server's page, served from a fresh fixture. Fails on any console error, page error
// or CSP violation. Usage: bun tests/smoke.mjs [STATIC_DIR], STATIC_DIR the built page (default build/).
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { chromium } from "playwright";

const here = resolve(import.meta.dirname, "..");
const root = resolve(here, "..");
const built = resolve(process.argv[2] ?? join(here, "build"));
const tmp = mkdtempSync(join(tmpdir(), "prg-smoke-"));
const fx = join(tmp, "fx");
const servers = [];
// A tunnel and a GitHub login that need no network: the owner is "owner" and may check collaborators on o/r.
const bin = join(tmp, "bin");
mkdirSync(bin);
const fake = (name, body) => {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
};
fake("cloudflared", 'echo "https://quiet-river-1234.trycloudflare.com" >&2\nexec sleep 600');
fake(
  "gh",
  `case "$*" in
  "api user --jq "*) echo '{"id":1,"login":"owner","name":"Owner","avatar":"https://avatars.githubusercontent.com/u/1"}' ;;
  "api repos/o/r/collaborators/"*) exit 0 ;;
  *) echo "gh: not signed in" >&2; exit 1 ;;
esac`,
);
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
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PRG_GITHUB_CLIENT_ID: "test", CLAUDE_CONFIG_DIR: join(tmp, "claude") },
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

// The owner link opens once, so every owner page after the first is another tab in the browser that opened it.
const owners = new Map();
async function ownerPage(link, viewport = { width: 1400, height: 900 }) {
  const first = !owners.has(link);
  if (first) {
    owners.set(link, await browser.newContext({ viewport }));
  }
  const tab = await owners.get(link).newPage();
  await tab.setViewportSize(viewport);
  return { tab, url: first ? link : `${new URL(link).origin}/` };
}

async function open(link, hash = "", viewport = { width: 1400, height: 900 }) {
  const owned = await ownerPage(link, viewport);
  page = owned.tab;
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
  await page.goto(`${owned.url}${hash}`);
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
// What a box holds, or null when it isn't there: a probe that throws would end the walk.
// An editor's innerText, since its paragraphs are elements that textContent runs together.
const typed = box =>
  box
    .last()
    // biome-ignore lint/performance/useDomNodeTextContent: the line breaks between paragraphs are the point
    .evaluate(element => ("value" in element ? element.value : element.innerText.replace(/\n+$/, "")), null, { timeout: 500 })
    .catch(() => null);
// Empties an editor through Tiptap, which hangs itself on its element: fill("") and a select-all keypress both
// sometimes leave text behind in headless Chromium.
const clear = box => box.last().evaluate(element => element.editor.commands.clearContent(true));
const composerBox = () => page.getByRole("textbox", { name: /^Note or question about/ });
const followUp = () => page.getByRole("textbox", { name: /follow.?up/i });
// A 1x1 PNG, dropped as a file would be from Finder.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const dropImage = locator =>
  locator.evaluate((element, base64) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], "shot.png", { type: "image/png" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
  }, PNG);
const threadList = () => page.getByRole("navigation", { name: "Threads with Claude" });

try {
  const made = spawnSync("python3", [join(root, "tests/fixture.py"), fx], { encoding: "utf8" });
  if (made.status) {
    throw new Error(`fixture.py failed: ${made.stderr}`);
  }
  const work = await serve("work", join(fx, "work"));
  const stack = await serve("stack", join(fx, "stack"));
  browser = await chromium.launch();
  // The test plays the session where one is needed.
  const auth = { Authorization: `Bearer ${work.token}`, "content-type": "application/json" };
  const asSession = (path, body) => fetch(`${work.origin}/api/${path}`, { method: "POST", headers: auth, body: JSON.stringify(body) });
  const said = async () => (await fetch(`${work.origin}/api/messages`, { headers: auth })).json();

  // The session lists the skills it can run as it starts the server, as SESSION.md says.
  await asSession("skills", [
    { name: "frontend-design:frontend-design", description: "Design guidance for UI" },
    { name: "simplify", description: "Review changed code for reuse" },
    { name: "receiving-code-review", description: "Weigh feedback before acting on it" },
    { name: "code-review:code-review", description: "Code review a pull request" },
    { name: "code-review", description: "Find bugs in the current diff" },
  ]);
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
  // Each row of the ready check is marked by how much it needs the reader, as its chip in the header is coloured.
  const toneOf = title =>
    page
      .getByRole("region", { name: "Before you mark it ready" })
      .locator("details[data-tone]", { hasText: title })
      .first()
      .getAttribute("data-tone");
  await check(
    "the ready check marks a failing annotation as wrong, flagged lines to look at, and what the diff carries out as settled",
    async () => [await toneOf("CI annotations"), await toneOf("Flagged lines"), await toneOf("What the diff carries out")],
    tones => tones.join() === "bad,warn,good",
  );
  await check(
    "and a step nobody has tried yet as neither",
    () => toneOf("Try by hand"),
    tone => tone === "quiet",
  );
  await check(
    "the size chip counts the lines outside tests and names the test lines beside them",
    () => page.locator("header").first().textContent(),
    text => text.includes("15 lines in 4 files, plus 9 in tests: fits one sitting"),
  );
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
  // The title starts with the words a screen reader gets for its mark.
  await check("a ticked step to try stays ticked after a reload", tried, text => text.endsWith("Try by hand (1 of 1)"));
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
  // The drawer's box belongs to what it is about: Ask Claude on another thing opens that thing's own text.
  const ask = key => page.locator(`button[data-ask='${key}']`).first().click();
  await ask("try:0:0");
  await composerBox().fill("About the step.");
  await ask("claim:0:missing:0");
  await check(
    "text typed about one thing doesn't follow the drawer to another",
    () => typed(composerBox()),
    text => text === "",
  );
  await composerBox().fill("About the claim.");
  await ask("try:0:0");
  await check(
    "and is there again on the way back",
    () => typed(composerBox()),
    text => text === "About the step.",
  );
  await clear(composerBox());
  await ask("claim:0:missing:0");
  await check(
    "while the other thing keeps its own",
    () => typed(composerBox()),
    text => text === "About the claim.",
  );
  await clear(composerBox());
  // A reload puts the drawer back on the review as a whole, where the checks below expect it.
  await page.reload();
  await tryBlock.getByRole("checkbox").uncheck();
  await check("and the step unticks", tried, text => text.endsWith("Try by hand (0 of 1)"));

  // The template is one page; here the sections are the Guide tab.
  await tab("Guide");
  await page.waitForSelector(SECTION);
  // A jump lights up the rows it lands on, with a bar down their edge, rather than outlining the file's card.
  await page.locator(`${SECTION} a[href^='#f']`).first().click();
  await check(
    "a link in a section lights up rows, not the card",
    () => page.locator("[data-flash]").evaluateAll(marked => marked.map(element => element.tagName).join()),
    tags => tags !== "" && tags.split(",").every(tag => tag === "TBODY" || tag === "TR"),
  );
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
  const own = await primary();
  await page.getByRole("button", { name: /^Theme: / }).click({ modifiers: ["Shift"] });
  await page.getByRole("radio", { name: "Twitter" }).click();
  await check(
    "shift-click on the theme button lists the palettes, and picking one recolours the page",
    async () => (await primary()) !== own,
  );
  await page.getByRole("radio", { name: "Modern Minimal" }).click();
  await check("picking Modern Minimal again puts the page's own colours back", async () => (await primary()) === own);
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
  await line.getByRole("button", { name: "Note on line 5" }).hover();
  await page.mouse.down();
  // posts.ts ends at line 5, so the drag runs up.
  await page.locator(`[id='${(await line.getAttribute("id")).replace(/R5$/, "R3")}']`).hover();
  await page.mouse.up();
  await check(
    "a drag from a line's + across two more lines opens a note on all three",
    () =>
      composerBox()
        .getAttribute("aria-label", { timeout: 500 })
        .catch(() => null),
    label => label?.endsWith(":R3-R5"),
  );
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
  // The owner's chat box offers the skills the session listed after /.
  const askBox = page.getByRole("textbox", { name: "Ask Claude about this review" });
  await askBox.pressSequentially("/rev");
  await check(
    "/ lists the skills the session can run, matching names first, the shorter first, then descriptions",
    () => page.getByRole("listbox", { name: "Skills" }).getByRole("option").allInnerTexts(),
    options =>
      options.length === 4 &&
      options[0].startsWith("/code-review\n") &&
      options[1].startsWith("/code-review:code-review") &&
      options[2].startsWith("/receiving-code-review") &&
      options[3].startsWith("/simplify"),
  );
  await page.keyboard.press("Enter");
  await check(
    "and a pick writes it into the message",
    () => typed(askBox),
    text => text?.trim() === "/code-review",
  );
  await clear(askBox);
  await dropImage(page.getByRole("textbox", { name: "Ask Claude about this review" }));
  await check(
    "a screenshot dropped into the chat box waits there to be sent",
    () => count("button[aria-label='Remove this screenshot']"),
    n => n === 1,
  );
  await page.getByRole("textbox", { name: "Ask Claude about this review" }).fill("Is this safe to merge?");
  await page.keyboard.press("Enter");
  await check(
    "and is sent with the message, which shows it",
    () => page.locator("img[alt='Attached screenshot']").evaluateAll(images => images.map(image => image.naturalWidth)),
    widths => widths.length === 1 && widths[0] === 1,
  );
  await threadList()
    .getByRole("button", { name: /Is this safe to merge/ })
    .click();
  await page.getByRole("button", { name: "Archive this thread" }).click();
  await check(
    "archiving a thread moves it to the Archived list",
    () => threadList().locator("summary").textContent(),
    text => text === "Archived (1)",
  );
  await threadList().locator("summary").click();
  await threadList()
    .getByRole("button", { name: /Is this safe to merge/ })
    .click();
  await page.getByRole("button", { name: "Unarchive this thread" }).click();
  await check(
    "and unarchiving brings it back",
    () => threadList().locator("summary").count(),
    n => n === 0,
  );
  await page.keyboard.press("Escape");

  // A review asked for from the page. The test plays the session: it hands back two findings and a recommendation.
  await tab("Overview");
  await check(
    "the review button stays an outline until the reader's own pass",
    () => page.getByRole("button", { name: "Ask Claude for a review" }).getAttribute("class"),
    classes => !classes.includes("bg-primary "),
  );
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
  const patch = page.locator("figure", { hasText: "Proposed patch" });
  await check(
    "a finding shows the patch Claude proposes, coloured as the file's code",
    async () => (await patch.locator(".hljs-keyword").count()) > 0 && (await patch.locator("pre > span").first().textContent()),
    first => first === "-  return prefix + slugify(title);",
  );
  await page.keyboard.press("Escape");
  await found.getByRole("button", { name: "Open this finding's thread" }).nth(1).click();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await page.getByRole("menuitem", { name: "False positive" }).click();
  await check(
    "a dismissed finding stays in the review with its reason",
    () => found.textContent(),
    text => text?.includes("1 open, 1 fixed, 1 dismissed") && text.includes("Dismissed: false positive"),
  );
  // A rebuild at a new head sends the open finding back to Claude. An answer that it still holds settles nothing, so
  // the finding can still be fixed or dismissed; one Claude declines is no longer open.
  await page.keyboard.press("Escape");
  const git = (...args) => spawnSync("git", ["-C", join(fx, "repo"), ...args], { encoding: "utf8" }).stdout.trim();
  git("commit", "-q", "--allow-empty", "-m", "an empty commit, for a new head");
  const newHead = git("rev-parse", "HEAD");
  const hunksFile = join(fx, "work", "hunks.json");
  const hunks = JSON.parse(readFileSync(hunksFile, "utf8"));
  writeFileSync(hunksFile, JSON.stringify({ ...hunks, meta: { ...hunks.meta, headSha: newHead } }));
  await asSession("reload", {});
  await check(
    "a rebuild at a new head sends the open finding back to Claude",
    async () => (await finding("The prefix is hard-coded.")).review.seen,
    seen => seen === newHead,
  );
  const hardcoded = await finding("The prefix is hard-coded.");
  await asSession("replies", { replyTo: hardcoded.id, text: "It still holds: the prefix is still hard-coded." });
  await found.getByRole("button", { name: "Open this finding's thread" }).first().click();
  await check(
    "a finding Claude says still holds keeps Fix this and Dismiss",
    () =>
      Promise.all([
        page.getByRole("button", { name: "Fix this", exact: true }).count(),
        page.getByRole("button", { name: "Dismiss" }).count(),
      ]),
    ([fix, dismiss]) => fix === 1 && dismiss === 1,
  );
  await check(
    "and still counts for Fix the recommended",
    () => found.textContent(),
    text => text?.includes("Fix the recommended (1)"),
  );
  await asSession("replies", { replyTo: hardcoded.id, state: "declined", text: "Left as it is: the prefix lives in one place." });
  await check(
    "a finding Claude declines is no longer open or one to act on",
    () => found.textContent(),
    text => text?.includes("1 fixed, 1 declined, 1 dismissed") && !text.includes("Act on this"),
  );
  await page.getByRole("button", { name: `Archive every thread of review ${reviewNo}` }).click();
  await check(
    "archiving a review puts all of its threads away",
    () => found.count(),
    n => n === 0,
  );
  // Claude settles a thread while a follow-up is half typed: the text stays, through the drawer closing and a look at the notes.
  await threadList()
    .getByRole("button", { name: /Is this safe to merge/ })
    .click();
  await followUp().last().fill("And is it safe to dep");
  const safe = (await said()).find(m => m.text === "Is this safe to merge?");
  await asSession("replies", { replyTo: safe.id, state: "answered", text: "Yes, once CI is green." });
  await check(
    "Claude settling a thread leaves a half-typed follow-up in its box",
    async () => [await page.getByText("Yes, once CI is green.").count(), await typed(followUp())],
    ([answer, text]) => answer > 0 && text === "And is it safe to dep",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Chat/ }).click();
  await check(
    "it is still there after the drawer closes and opens",
    () => typed(followUp()),
    text => text === "And is it safe to dep",
  );
  await page.getByRole("button", { name: /^Notes/ }).click();
  await page.getByRole("button", { name: /^Chat/ }).click();
  await check(
    "and after a look at the notes",
    () => typed(followUp()),
    text => text === "And is it safe to dep",
  );
  // The follow-up box formats markdown as it is typed: Shift+Enter starts a line, a fence and a language then Enter start a code block, in which
  // Enter is a new line, and ⌘↵ sends from anywhere.
  await clear(followUp().last());
  await followUp().last().pressSequentially("Try _this_ first");
  await followUp().last().press("Shift+Enter");
  await followUp().last().pressSequentially("```ts");
  await followUp().last().press("Enter");
  await followUp().last().pressSequentially("const a = 1");
  await followUp().last().press("Enter");
  await followUp().last().pressSequentially("export { a }");
  await check(
    "the follow-up box shows emphasis and a code block as they are typed, and Enter in the block doesn't send",
    async () => [
      await followUp().last().locator("em").count(),
      await followUp()
        .last()
        .locator("pre")
        .textContent()
        .catch(() => null),
    ],
    ([em, code]) => em === 1 && code === "const a = 1\nexport { a }",
  );
  await followUp().last().press("ControlOrMeta+Enter");
  await check(
    "and what is sent is markdown, which the thread shows formatted, its code coloured",
    async () => [
      (await said()).findLast(m => m.text.includes("export { a }"))?.text,
      await page.locator(".prg-chat em, [role=dialog] em, em").filter({ hasText: "this" }).count(),
      await page.locator("pre", { hasText: "export { a }" }).locator(".hljs-keyword").count(),
    ],
    ([sent, em, pre]) => sent === "Try *this* first\n\n```ts\nconst a = 1\nexport { a }\n```" && em > 0 && pre > 0,
  );
  await page.keyboard.press("Escape");

  // Rebuild at the top asks the session as a chat thread, which the button opens until the session settles it.
  await page.getByRole("button", { name: "Rebuild the guide", exact: true }).click();
  const rebuild = async () => (await said()).find(m => m.text.startsWith("Rebuild the guide"));
  await check(
    "Rebuild asks the session, and with none listening says the request is waiting rather than spinning",
    async () => [Boolean(await rebuild()), await page.getByRole("button", { name: "Rebuild the guide (waiting for a session)" }).count()],
    ([asked, busy]) => asked && busy === 1,
  );
  await asSession("replies", { replyTo: (await rebuild()).id, state: "done", text: "Rebuilt: unchanged." });
  await check(
    "and goes back to Rebuild once the session has done it",
    () => page.getByRole("button", { name: "Rebuild the guide", exact: true }).count(),
    n => n === 1,
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

  // The same person on a second page is not shown to themselves. A guest can't reach a tunnel host from here, so one
  // is faked at the presence endpoint and the walk checks how the page draws and uses it.
  await open(work.link);
  await tab("Guide");
  await page.waitForSelector(SECTION);
  const other = await ownerPage(work.link);
  const second = other.tab;
  await second.goto(other.url);
  await second.waitForSelector("[role=tablist]");
  await page.waitForTimeout(1200);
  await check(
    "the same person on two pages shows no avatar",
    () => count("[data-presence]"),
    n => n === 0,
  );
  await second.close();
  const { layers } = await (await fetch(`${work.origin}/api/review`, { headers: { Authorization: `Bearer ${work.token}` } })).json();
  const guest = { id: 2, login: "gus", name: null, avatar: "https://avatars.githubusercontent.com/u/2" };
  const entry = {
    person: guest,
    role: "guest",
    layer: layers[0].id,
    tab: "guide",
    section: 1,
    hidden: false,
    since: new Date().toISOString(),
  };
  const dot = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHuJ5PwAAAABJRU5ErkJggg==", "base64");
  await page.route("**/api/github/avatar/gus", route => route.fulfill({ body: dot, contentType: "image/png" }));
  await page.route("**/api/presence", route => route.fulfill({ json: [entry] }));
  await page.reload();
  await page.waitForSelector(SECTION);
  const rail = page.getByRole("navigation", { name: "Sections" });
  await check(
    "the rail shows the guest beside their section",
    () => rail.locator("div:has(> button[aria-label^='02']) [data-presence=gus]").count(),
    n => n === 1,
  );
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await rail.locator("[data-presence=gus]").click();
  await check(
    "clicking the guest lands on their section",
    () => page.evaluate(() => window.scrollY),
    y => y > 0,
  );
  await page.close();

  // Sharing, from the owner's side, on the stack, which is the review that knows its repo. The tunnel is a fake.
  await open(stack.link);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Start sharing" }).click();
  await check(
    "Share shows a link ending in the guest code",
    () => page.getByRole("textbox", { name: "Share link" }).inputValue(),
    link => /^https:\/\/quiet-river-1234\.trycloudflare\.com\/\?g=[0-9a-f]+$/.test(link),
  );
  await check("and says guests see every thread", () => page.getByText("Guests will see every thread on this review").count());
  await page.getByRole("button", { name: "Make a link" }).click();
  await check(
    "Make a link gives a new single-use owner link here and on the tunnel",
    async () => [
      await page.getByRole("textbox", { name: "This computer" }).inputValue(),
      await page.getByRole("textbox", { name: "The share tunnel" }).inputValue(),
    ],
    ([here, tunnel]) => /\/\?t=[0-9a-f]{48}$/.test(here) && !here.endsWith(new URL(stack.link).search) && tunnel.startsWith("https://"),
  );
  await page.getByRole("button", { name: "Stop sharing" }).click();
  await check(
    "Stop sharing clears the link",
    () => page.getByRole("textbox", { name: "Share link" }).count(),
    n => n === 0,
  );
  await page.close();

  // The owner link has been opened, so a browser that never opened it gets no owner cookie from it.
  page = await browser.newPage();
  const reused = await page.goto(work.link);
  await check(
    "an owner link opened a second time gets 401 and says why",
    async () => reused.status() === 401 && (await page.content()).includes("opened already"),
  );
  await page.close();

  // The tunnel is the only host a share link works on, so here an old code gets the server's own page.
  page = await browser.newPage();
  const old = await page.goto(`${work.origin}/?g=old`);
  await check(
    "a share link with an old code gets 401",
    async () => old.status(),
    status => status === 401,
  );
  await check("and a page saying to ask for a new one", () =>
    page.getByText("ask whoever shared it with you for a new one", { exact: false }).count(),
  );
  await page.close();

  // A guest can't reach a tunnel host from here, so the owner's page is told it is a guest.
  await asSession("replies", {
    replyTo: (await said()).find(m => m.text === "Is this safe to merge?").id,
    text: "Shall I merge it?",
    ask: [{ question: "Merge now?", options: ["Yes", "No"], owner: true }],
  });
  const asGuest = {
    role: "guest",
    person: { id: 2, login: "gus", name: null, avatar: "https://avatars.githubusercontent.com/u/2" },
    sharing: true,
  };
  const asOwner = await ownerPage(work.link);
  page = asOwner.tab;
  await page.route("**/api/me", route => route.fulfill({ json: asGuest }));
  await page.goto(asOwner.url);
  await page.waitForSelector("[role=tablist]");
  await check(
    "a guest has no Rebuild or Share button",
    () => count("button:text-is('Rebuild'), button:text-is('Share')"),
    n => n === 0,
  );
  await page.getByRole("button", { name: /^Chat/ }).click();
  await threadList()
    .getByRole("button", { name: /Is this safe to merge/ })
    .click();
  await check("an owner-only question shows a guest that it waits on the owner", () => page.getByText("Waiting on @owner").count());
  await check(
    "and offers no options",
    () => page.getByRole("radio", { name: "Yes" }).count(),
    n => n === 0,
  );
  await asSession("replies", { replyTo: (await said()).find(m => m.text === "Is this safe to merge?").id, text: "Merged." });
  await page.close();

  // The same page at a phone's width. Its socket goes through the walk, which can then drop it.
  await open(work.link, "", { width: 390, height: 844 });
  const sockets = new Set();
  let down = false;
  await page.routeWebSocket(/\/api\/ws/, socket => {
    if (down) {
      socket.close();
    } else {
      sockets.add(socket).add(socket.connectToServer());
    }
  });
  await page.reload();
  await tab("Guide");
  await page.waitForSelector(SECTION);
  await check("at a phone's width nothing runs off the side", () =>
    page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  // The first card was ticked above and is folded, so the line is one that shows.
  await page.locator("td[data-ln][data-line^='R']:visible").first().click();
  await composerBox().fill("A note from the phone.");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  const phoneNote = page.locator(NOTE, { hasText: "A note from the phone." });
  await check(
    "a tap on a line's number takes a note there",
    () => phoneNote.count(),
    n => n === 1,
  );
  await phoneNote.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: /^Chat/ }).click();
  const back = page.getByRole("button", { name: "All threads" });
  await check(
    "the drawer opens on the list of threads alone",
    async () => [await threadList().isVisible(), await back.count()],
    ([list, button]) => list && button === 0,
  );
  await threadList()
    .getByRole("button", { name: /Is this safe to merge/ })
    .click();
  await check(
    "a thread takes the list's place, with a way back",
    async () => [await threadList().isVisible(), await page.getByText("Yes, once CI is green.").isVisible()],
    ([list, thread]) => !list && thread,
  );
  await back.click();
  await check("and All threads goes back to the list", () => threadList().isVisible());
  await page.keyboard.press("Escape");
  const status = text => page.locator("[aria-live=polite]", { hasText: text }).count();
  down = true;
  for (const socket of sockets) {
    await socket.close();
  }
  await check("a dropped socket shows as a lost server", () => status("Lost the server"));
  down = false;
  await check("and the page is live again once the socket is back", () => status("Not listening"));
  await page.close();
  console.log("phone page ok");

  {
    // Claude tries a step when the owner asks, and what it found shows under the step.
    await open(work.link);
    const tryList = page.getByRole("region", { name: "Before you mark it ready" }).locator("details", { hasText: "Try by hand" }).first();
    await tryList.getByRole("button", { name: "Have Claude try them" }).click();
    await check("with no session listening, a step asked for says it waits for one", () =>
      tryList.getByText("Waiting for a session to try this").count(),
    );
    await check(
      "and the button goes, since the step says it itself",
      () => tryList.getByRole("button", { name: /Have Claude try/ }).count(),
      n => n === 0,
    );
    const asked = (await said()).findLast(m => m.text === "Try this and show what happened.");
    const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const shot = await (
      await fetch(`${work.origin}/api/attachments`, { method: "POST", headers: { Authorization: auth.Authorization }, body: pixel })
    ).json();
    await asSession("replies", { replyTo: asked.id, tried: "failed", text: "The old link gives a 404.", images: [shot.id] });
    const found = tryList.locator("details[data-tried='failed']");
    await check(
      "a step that failed marks Try by hand as wrong",
      () => tryList.getAttribute("data-tone"),
      tone => tone === "bad",
    );
    await check("what Claude found shows under the step", () => found.getByText("Claude tried it: failed").count());
    await check(
      "a step that failed opens by itself, with what Claude did and its screenshot",
      async () => [
        await found.getByText("The old link gives a 404.").isVisible(),
        await found.locator("img[alt='Attached screenshot']").count(),
      ],
      ([text, images]) => text && images === 1,
    );
    await check(
      "and a step tried at this head isn't offered again",
      () => tryList.getByRole("button", { name: /Have Claude try/ }).count(),
      n => n === 0,
    );

    // The owner ticks the routine section. A guest can't reach a tunnel host from here, so the owner's page is told it
    // is a guest whose own ticks are none and who sees the owner's.
    await tab("Guide");
    await page.waitForSelector(SECTION);
    const inSection = page.locator("section[data-section='0'] [data-step]");
    await check(
      "the step shows in the section its link points into, with what Claude found folded under it",
      async () => [
        await inSection.getByText("Try by hand:").count(),
        await inSection.locator("details[data-tried='failed']:not([open])").getByText("Claude tried it: failed").count(),
      ],
      ([step, tried]) => step === 1 && tried === 1,
    );
    await check(
      "and in no other section",
      () => page.locator("section[data-section='1'] [data-step]").count(),
      n => n === 0,
    );
    await page.locator("section[data-section='1'] input[data-tick='section']").check();
    const ownTicks = await (await fetch(`${work.origin}/api/ticks`, { headers: auth })).json();
    await page.close();
    const guestView = await ownerPage(work.link);
    page = guestView.tab;
    const owner = { id: 1, login: "owner", name: "Owner", avatar: "" };
    await page.route("**/api/me", route =>
      route.fulfill({ json: { role: "guest", person: { id: 2, login: "gus", name: null, avatar: "" }, sharing: true } }),
    );
    await page.route("**/api/ticks/people", route => route.fulfill({ json: [{ role: "owner", person: owner, keys: ownTicks }] }));
    await page.route("**/api/ticks", route => (route.request().method() === "GET" ? route.fulfill({ json: [] }) : route.continue()));
    await page.goto(guestView.url);
    await page.waitForSelector("[role=tablist]");
    const look = page
      .getByRole("region", { name: "Before you mark it ready" })
      .locator("details", { hasText: "Where a second look matters" });
    await check("a guest is told where a second look matters", () => look.getByText("Old /posts links stop resolving.").count());
    await check("and how much the owner has reviewed", () =>
      look.getByText("The owner has reviewed 1 of 2 sections.", { exact: false }).count(),
    );
    await tab("Guide");
    await page.waitForSelector(SECTION);
    const routine = page.locator("section[data-section='1']");
    await check("a routine section says who reviewed it", () => routine.getByText("@owner (owner) has reviewed this").count());
    await check(
      "and its cards start folded for a guest, saying why",
      async () => [
        await routine.locator(`${CARD} > details[open]`).count(),
        await routine.getByText("The owner has reviewed this.", { exact: true }).count(),
      ],
      ([open, why]) => open === 0 && why >= 1,
    );
    await check(
      "while the section that needs a careful read stays open",
      () => page.locator(`section[data-section='0'] ${CARD} > details[open]`).count(),
      n => n >= 1,
    );
    await page.unroute("**/api/me");
    await page.close();
  }
  console.log("evidence and second look ok");

  {
    // A note Claude won't act on without the owner waits on the owner, who can have every such note fixed at once.
    // The fix then says where the change is and what was run to check it.
    await open(work.link);
    const ownerKey = new URL(work.link).searchParams.get("t");
    const asOwner = (path, data) =>
      owners.get(work.link).request.post(`${work.origin}/api/${path}`, { headers: { "x-prg-key": ownerKey, origin: work.origin }, data });
    const layer = (await (await fetch(`${work.origin}/api/review`, { headers: auth })).json()).layers[0];
    const file = layer.files.find(f => f.hunks.some(hunk => hunk.lines.some(row => row[0] === "+")));
    const hunk = file.hunks.find(h => h.lines.some(row => row[0] === "+"));
    const line = hunk.lines.find(row => row[0] === "+")[2];
    const anchor = { kind: "line", layer: layer.id, file: file.id, hunk: hunk.id, side: "R", line };
    const note = await (await asOwner("messages", { kind: "note", text: "Escape the slug first.", anchor })).json();
    await asOwner("messages/send");
    await asSession("replies", {
      replyTo: note.id,
      text: "That changes how every link is built.",
      ask: [{ question: "Change it?", options: ["Yes", "No"], owner: true }],
    });
    const dock = page.locator("div.fixed.bottom-0");
    const mine = () => dock.locator(`#t-${note.id}`);
    const openMine = async () => {
      await dock.getByRole("button", { name: /^Chat/ }).click();
      await threadList()
        .getByRole("button", { name: /Escape the slug first/ })
        .first()
        .click();
    };
    await check(
      "the tab's title counts the threads that wait on its reader",
      () => page.title(),
      title => /^\(\d+\) /.test(title),
    );
    await openMine();
    await check("the drawer lists what waits on the reader first", () =>
      threadList()
        .getByText(/^Waiting on you \(\d+\)$/)
        .count(),
    );
    await check("and the thread says it is the reader's turn", () => mine().getByText("Your turn", { exact: true }).count());
    await asOwner("messages", { kind: "post", text: "Looking at this now.", replyTo: note.id });
    await check(
      "a post under Claude's question leaves it standing",
      async () => [await mine().getByText("Looking at this now.").count(), await mine().getByText("Change it?").isVisible()],
      ([posted, asked]) => posted === 1 && asked,
    );
    await page.keyboard.press("Escape");

    await dock.getByRole("button", { name: /^Notes/ }).click();
    await dock.getByRole("button", { name: /^Fix the open notes \(\d+\)$/ }).click();
    await check("Fix the open notes asks for the note on its own thread", async () =>
      (await said()).some(m => m.replyTo === note.id && m.from === "user" && m.text === "Fix this."),
    );
    await check(
      "and a note that has been asked for isn't offered again",
      () => dock.getByRole("button", { name: /^Fix the open notes/ }).count(),
      n => n === 0,
    );
    await page.keyboard.press("Escape");

    await asSession("replies", {
      replyTo: note.id,
      state: "done",
      text: "The slug is escaped before it joins the path.",
      fix: { file: file.path, line },
      checks: [
        { run: "bun test tests/posts.test.ts", passed: true },
        { run: "bun run lint", passed: false },
      ],
    });
    await openMine();
    const ran = mine().getByRole("list", { name: "Checks Claude ran" }).locator("li");
    await check(
      "a fix lists the checks Claude ran, and which failed",
      async () => [await ran.count(), await ran.filter({ hasText: "Failed:" }).count(), await ran.last().textContent()],
      ([all, failed, last]) => all === 2 && failed === 1 && last.includes("bun run lint"),
    );
    await mine()
      .getByRole("button", { name: `${file.path}:${line}`, exact: true })
      .click();
    await check(
      "and where the change is jumps to that line, closing the drawer",
      async () => [await page.locator(`#l${layer.id}-${file.id}-R${line}`).isVisible(), await threadList().isVisible()],
      ([there, drawer]) => there && !drawer,
    );
    await page.close();
  }
  console.log("closing the loop ok");

  {
    // The owner asks for a quiz and takes it. A wrong pick points back at the code, and the right one says why.
    await open(work.link);
    const layer = (await (await fetch(`${work.origin}/api/review`, { headers: auth })).json()).layers[0];
    const file = layer.files.find(f => f.hunks.some(hunk => hunk.lines.some(row => row[0] === "+")));
    const hunk = file.hunks.find(h => h.lines.some(row => row[0] === "+"));
    const ready = page.getByRole("region", { name: "Before you mark it ready" });
    const quiz = ready.locator("details[data-quiz]");
    await ready.getByRole("button", { name: "Quiz me", exact: true }).click();
    await check("a quiz asked for with no session listening says it waits for one", () =>
      quiz.getByText("Waiting for a session to write the questions.").count(),
    );
    const request = (await said()).findLast(m => m.quiz && m.from === "user");
    await asSession(`quiz/${request.quiz.n}/questions`, {
      questions: [
        {
          file: file.path,
          line: hunk.lines.find(row => row[0] === "+")[2],
          question: "What does an old link do now?",
          options: ["It gives a 404", "It redirects"],
          answer: 0,
          why: "Nothing serves the old prefix.",
        },
        { question: "What else has to change?", options: ["Nothing", "Links elsewhere"], answer: 1, why: "Old links stop resolving." },
      ],
    });
    await asSession("replies", { replyTo: request.id, state: "answered", text: "Two questions on the old links." });
    const first = quiz.locator("li[data-question]").first();
    await check(
      "the questions show in the ready check, none answered",
      async () => [await quiz.locator("li[data-question]").count(), await quiz.locator("summary").textContent()],
      ([questions, title]) => questions === 2 && title.endsWith("(0 of 2)"),
    );
    await first.getByRole("button", { name: /It redirects/ }).click();
    await check(
      "a wrong pick is struck out and points back at the code",
      async () => [await first.locator("button[data-option='wrong']:disabled").count(), await first.getByText("Not that one.").count()],
      ([wrong, hint]) => wrong === 1 && hint === 1,
    );
    await first.getByRole("button", { name: /It gives a 404/ }).click();
    await check(
      "the right pick says why, and counts",
      async () => [
        await first.getAttribute("data-question"),
        await first.getByText("Nothing serves the old prefix.").count(),
        await quiz.locator("summary").textContent(),
      ],
      ([state, why, title]) => state === "right" && why === 1 && title.endsWith("(1 of 2)"),
    );
    await page.locator("div.fixed.bottom-0").getByRole("button", { name: /^Chat/ }).click();
    await check(
      "a question isn't a thread in the drawer",
      async () => [await threadList().isVisible(), await threadList().getByText("What does an old link do now?").count()],
      ([drawer, listed]) => drawer && listed === 0,
    );
    await page.keyboard.press("Escape");
    await first.locator("button.font-mono").click();
    await check("and where its code is jumps to that hunk", () => page.locator(`#l${layer.id}-${hunk.id}`).isVisible());
    await page.close();
  }
  console.log("quiz ok");

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
