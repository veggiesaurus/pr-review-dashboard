# A desktop mod for the review guide

A plan for turning the pr-review-guide skill into a mod: a plugin whose hooks module draws a pane beside the chat in the Claude desktop app's Code tab, puts your notes into the conversation and keeps CI in view. It covers what the mod should do, what it should leave to the app, and how to build it. It was written against the mod API of Claude Code 2.1.318 (early access, so names may move), the skill as it stands in this repo, the current Claude Code docs, Linear's diffs docs and Cognition's Devin Review posts.

It assumes the code is on GitHub and `gh` is installed and logged in, as the skill does now. Linear is optional. When the session can reach it, linked Linear issues are read and shown, and a few things can go to Linear; when it can't, the mod works the same and only the issue text is missing. The guide is always the mod's own, built locally from the diff: Linear never generates it, hosts it or has to be there for it.

## The short version

Keep the plugin and add a hooks module to it. The Python scripts stay the engine. Five things change.

1. **The guide is a pane beside the chat**, not a browser tab: the ready check, the sections and their diffs, ticks and notes, with the chat usable while you read.
2. **Notes go into the chat as a turn**, and Claude resolves each one through a tool, so the pane shows what was fixed, answered or declined and offers the rebuild. No comment threads, 4 KB parts, consent prompts or watching session.
3. **The mod runs the pipeline as code.** It runs `collect.py`, spawns the digest, guide, description and check workers as agent types it registers, with the models and efforts SKILL.md names today, and checks what each hands back. The sections come out as the skill's do, from the same prompts and checks. The conversation stays yours.
4. **CI comes in live through `gh`**: check status, lint and type errors under their lines, a digest of each failing job tied to the section it breaks, and a `ci` tool Claude calls when you ask why the build is red.
5. **Linear when it's there.** Linked Linear issues are read for the description check and shown in the ready check with their state. With no Linear in reach they are listed by key, as now, and nothing else changes.

The HTML page stays, as the version you share with a reviewer.

## What the app already does

The desktop app has review features of its own now. The mod sits beside them rather than redoing them.

| In the app | What the mod does instead |
| --- | --- |
| A diff view of the changes, `+` on a line to comment, Cmd+Enter to send every comment to Claude | Sections with why, how and risk; noise hidden; moves shown once; what is new since the last build; notes that find their line again after a rebuild and come back resolved |
| The `/code-review` card, fed by the `ReportFindings` tool: findings by file, Walk through in diff, Fix this one, Apply fixes | Shows the same findings on their hunks in the guide, beside your notes. No second fix button. |
| PR status and CI in the Changes card; Auto-fix, which fixes failing CI and review comments on its own; Merge when ready | CI on the lines it is about and in the ready check, a warning when CI ran on an older head, and a digest of each failing job. It reads Auto-fix's events and never acts on them. |
| Managed Code Review (Team and Enterprise): inline comments graded Important, Nit or Pre-existing, and a check run | Its comments come in as threads on their lines (0.4) |

## What Devin Review and Linear do

Both shipped large updates on 5 November 2026.

**Devin Review 2.0** is mostly about cost and automation: $0.25 to $0.75 for a typical review, re-runs that review only what changed, rules for which PRs get reviewed, an autofix loop that fixes, dismisses or escalates each finding and then reviews again, and Normal and Ultra effort. The review page groups related edits and explains them top to bottom ("a guided tour of the PR"), detects copies and moves, hides whitespace, highlights changed words, and has split view, viewed files, a lines-left counter, a Commits tab and stacks. Findings are Bugs, Flags and Security, on their lines. Ask Devin sees the diff, the codebase, and CI status and job logs; it opens from any finding or from a quoted selection (Cmd+I), and proposes edits it commits to the branch. On a PR Devin wrote, the session that opened it gets the findings first, and only what it can't fix is posted.

**Linear diffs** (the docs call them Reviews) brings PRs into Linear through the GitHub integration, with threads, reviews and resolution syncing both ways. Its Guide tab, which this skill is modelled on, splits a PR into sections with a why for each, core changes first and glue code apart, with an outline, reviewed marks on each section's files, a key to move between sections, comments shown in place, and a refresh when the PR updates. It hides formatting-only edits with syntax-aware highlighting, counts implementation lines by default and reads the same `.gitattributes` categories the skill does. Diffs from Linear's own coding sessions show live, uncommitted changes included, before a PR exists. CI is the thin part: overall status and a failed-checks filter, with inline annotations and check output marked "not yet". Comments from agents get Send to agent, and Linear's MCP server reads diffs and threads, saves draft comments with anchors, submits reviews and merges, but doesn't return the Guide itself.

What that means for the mod:

- **The guide is the mod's own.** Linear's Guide is for the reviewer, in Linear. The mod builds its own from the diff, for you, before anyone looks, and adds what Linear's doesn't: the description checked claim by claim, flagged lines, the ready check, what is new since the last build, and CI on its lines. It never reads or reuses Linear's.
- **CI is the gap.** Linear shows status only; Devin puts logs in its chat's reach. The mod can do both, inside the conversation that will fix the code.
- **Worth taking:** a lines-left counter, quoting a line into the chat, counting a note resolved only when its code changed, rebuilds that redo only what changed, a guide before the PR exists, and threads shown in the guide. Each is in the feature set below.
- **Worth leaving:** a bug finder with severities, and an autofix loop. In the app, `/code-review` and Auto-fix cover those.

## The feature set

Each release works on its own, with `gh` and without Linear. The first is the loop the skill already has, moved into the app; the second is CI; the rest widen it.

### 0.2: the loop, in the app

- **Build from the chat.** `/guide`, `/guide 123`, `/guide stack`, or asking in words, which reaches a `guide` tool. A branch with no PR yet works too, uncommitted changes included, and when its name carries an issue key and Linear is in reach, it is checked against that issue. The pane opens and shows each step as it runs (collecting, 3 digests, writing sections, checking, settling 2 disputes), about two minutes for a 600-line PR, and you can keep talking to Claude meanwhile.
- **The pane.** A header with the PR, its size band and CI, then four views: Ready, Sections, Notes and CI. A section shows its title, risk note, why and how (their links jump to hunks), then its files and hunks, with formatting hidden unless asked, moves folded and flagged lines marked. Reviewed ticks per file and section, kept across rebuilds by hunk signature as now.
- **Linked issues.** The issues a PR links, read as `collect.py` reads them now (closing words, Linear's Completes and Implements, issue links, a key in the title or branch name), show in the ready check with their title, state and whether this PR closes them, and the description check reads what they ask. GitHub issues come through `gh`. Linear issues come through Linear when the session has it, with their recent comments, where asks often change. A key Linear doesn't know, or any key with no Linear in reach (a Jira key looks the same), stays listed by key and link, and the description check works from the PR description alone. With Linear in reach and nothing linked, the ready check says so, and Find one asks Claude to look for the issue in Linear.
- **Notes on lines.** Click a line and type; the note is kept in the session, and across sessions until sent. Its location is `path:R<n>@<sha>` as today plus the line's text, so it finds its line again after a rebuild (Linear keeps an `anchorContent` on its diff drafts for the same reason).
- **Send to Claude.** Send N notes starts a turn holding them all, drawn in the transcript as one card. Put in prompt puts the same text in the prompt box instead, for adding context first. Claude answers each note through the `notes` tool with fixed, answered or declined and one line, and the note changes in the pane as it does. When the turn ends, a card under it sums up ("4 fixed, 1 answered") with Rebuild and Open guide.
- **Rebuild.** After a turn that edited files in the PR, the band offers a rebuild. It can take in uncommitted fixes: the mod builds from a commit object made through a temporary index (`GIT_INDEX_FILE`), which leaves the working tree and the index alone, and `collect.py --pr N --head SHA` keeps the PR's description, links and build history while diffing that commit. The pane then marks what is new since the last build and keeps the ticks on unchanged cards. A note Claude marked fixed whose lines did not change is flagged rather than closed, as Devin Review counts a finding resolved only when code fixed it.
- **Ask about a part.** Ask, on a section or hunk, or `q` on a line, fills the prompt with a reference ("About §3 Reset tabs after a switch, f9h2: ") and leaves the question to you, as Devin's Quote in chat does. Claude reads that part through the `guide` tool rather than holding the whole guide in context.
- **Claude can point.** `guide` with `focus` moves the pane to a section, hunk or line, so "where does the token get re-minted?" ends with the pane on it.
- **The pane follows Claude.** While Claude reads or edits a file in the PR, the pane marks the section it is in, and each Edit row in the transcript names the note or section it touches (a `tool.call` hook to watch, a `ToolUse` hook to draw).
- **A band above the prompt** while the branch has a PR: `#123 · CI 1 failing · 5 notes · 212 lines left to review`, with Guide, Send notes and Rebuild. A status line entry says the same in brief.

### 0.3: CI

- **Live status.** Check runs and commit statuses for the PR head through `gh`, refreshed every 20 seconds while any are pending (every 60 after five minutes), and at once when a `check_run` or `check_suite` event reaches the session. A toast when the last one finishes; the band and status line follow.
- **On the lines.** Annotations, the lint, type and test errors a check pins to a line, show under that line in the diff, and those outside the diff in the ready check, as the page does now.
- **Stale CI.** When CI ran on an older head than the build, the ready check says how many commits behind and which sections changed since.
- **Failure digests.** For a failing check: the failing step, the error lines and any `path:line` they name, tied to the hunks and sections they hit, from `gh run view --log-failed` for Actions and the check run's own output otherwise. Parsed rather than summarised, for the common formats (tsc, eslint, ruff, mypy, pytest, jest, go test, cargo), with a one-line Haiku summary only when nothing parses.
- **Act on it.** Fix this check starts a turn with the digest; Ask puts it in the prompt; Re-run failed jobs (`gh run rerun --failed`) asks you first.
- **A `ci` tool for Claude**: `status`, `failure` (the digest) and `log` (a tail, filtered and capped), so "why is CI red?" costs a few hundred tokens rather than a raw log.
- **`/code-review` findings in place.** The mod reads `ReportFindings` on its way to the app's card and pins the same findings to their hunks, as a layer you can hide. One press turns a finding into a note.
- **Rebuilds that redo only what changed.** After a round of small fixes, the guide worker gets the last guide and the new or changed hunks rather than the whole diff, and the checker reads only the sections they touch. Devin Review 2.0 re-reviews only what changed after a push for the same reason: cost and time. The sections stay put, so ticks and your sense of the PR carry over; but a fix can change what a section is for, so past a threshold (a quarter of the reviewable lines new, to start with), or when you ask, the build starts over from the whole diff.

### 0.4: threads and finishing

- **Reviewer threads in the pane**: the PR's review threads through `gh` (GraphQL `reviewThreads`, with their resolved and outdated state), each on its line. That includes Managed Code Review's comments, and comments left in Linear, which Linear syncs to GitHub.
- **Address threads** sends the threads you pick to Claude the way notes go, answered through the same tool. Replying and resolving is a separate press, through `gh` and with a confirmation, using the line Claude wrote. If your team reviews in Linear, the reply can carry Linear's `onBehalfOf` block naming Claude: GitHub doesn't render it, and Linear shows who wrote it.
- **File a follow-up.** A note you decide not to fix in this PR becomes an issue that links back to the PR and the line: in Linear, in the linked issue's team, when the session has Linear, and on GitHub through `gh issue create` when it doesn't. Behind a confirmation.
- **Fix the description.** The description check's mismatches go to Claude, which drafts a new description and posts it with `gh pr edit` only when you say so, through its own Bash call and your permission settings.
- **Mark ready** (`gh pr ready`) once the ready check is clean, behind a confirmation.

### 0.5: stacks, sharing, other people's PRs

- **Stacks in the pane**: the layer list with ↑ and ↓, cross-layer links and the stack check, from `stack.py` as now.
- **Share as page**: `render.py` writes the HTML and the mod publishes it with the Artifact tool, one page per PR as `artifacts.json` keeps it now.
- **Reviewing someone else's PR**: the same guide, with your notes posted as a GitHub review through `gh` when you say. Linear shows it too, if your team reviews there.
- **Risk notes for reviewers in Linear.** Linear diffs shows a risk score that a tool leaves on the PR as a `linear:extension` block in an HTML comment, in the description or a comment (`riskScore`, level 1 to 4, up to eight explanations of 200 characters, optionally pinned to a sha). The guide's risk notes fit that shape. It goes through `gh` and needs no Linear access; GitHub doesn't render it, so it is a setting, off unless your team reviews in Linear.

### Left out on purpose

- **Finding bugs in the guide workers.** The guide describes and groups; findings come from `/code-review` or Managed Code Review, as SKILL.md's common mistakes already says.
- **Fixing CI unasked.** Auto-fix does that, and two agents acting on one red build is worse than one.
- **Depending on Linear.** Nothing waits on it, asks for it or breaks without it, and the mod neither reads Linear's Guide nor moves an issue's status, which Linear's GitHub integration already does from the PR's state.
- **Merging, reviewers and labels**: the app and GitHub have those.
- **Mobile and VS Code** beyond the band and status line, until the desktop pane is right.

## How it is built

### One plugin, two halves

The repo is already a plugin. The mod adds a hooks module next to the skill, and nothing moves.

```
.claude-plugin/plugin.json    adds "types", and userConfig for models, CI polling and Linear
hooks/hooks.json              { "modules": ["./register.tsx"] }
hooks/register.tsx            wiring: session.start, commands, tools, agent types, events
hooks/pipeline.ts             find the PR, collect, workers, check, settle
hooks/ci.ts                   gh, polling, events, digests
hooks/linear.ts               finds Linear if the session has it; issues and follow-ups
hooks/notes.ts                notes, the message Claude reads, resolution
hooks/pane.tsx                the pane's views
hooks/diff.tsx                a Client module: draws a hunk, takes clicks and keys
hooks/band.tsx                band, status line, suggestions, transcript cards
types/index.d.ts              the $.state contract
skills/pr-review-guide/       scripts and prompts as now; SKILL.md becomes the fallback
tests/*.test.tsx              claude plugin test, looped over terminal and desktop
```

The skill stays for sessions that load no mods (`claude -p`, older builds, other harnesses), and shrinks to that. The mod reads the prompts in `reference/` with `$.fs.read` from `$.plugin.root`, so both halves use the same ones.

### The pipeline

Today SKILL.md walks the main conversation through eight steps. In the mod each step is a function, and the conversation hears about them only when something needs a decision.

1. **Find the PR.** `$.session.repo()` gives the root and the origin URL, `git rev-parse` through `$.process.run` the branch, and `gh pr view` the PR. It runs at `session.start` and again at each `turn.complete` that could have switched branches, so the band is right before any build.
2. **Collect.** `collect.py` runs as it does now, `gh` included, through `$.process.run` with `timeoutMs` at two minutes (the default is 30 seconds). It writes the linked GitHub issues' text to `issue.md` and lists the Linear and Jira keys it found but didn't fetch. When the session has Linear, the mod fetches those (`get_issue` and `list_comments`) and adds them to `issue.md` in the format SKILL.md uses now, before the description check starts; when it doesn't, they stay listed. One new pairing, `--pr N --head SHA`, builds a commit other than the PR's pushed head, for rebuilds with uncommitted fixes.
3. **Workers.** Five agent types, registered at `session.start` with `$.agent.register` and each hidden from the main model by an `agent.offer` hook: digest (Haiku), guide (Opus, medium), description (Opus, default), check (Opus, medium), and settle (Opus), which takes the main conversation's place as the tie-break on disputes. The mod spawns them as SKILL.md does: the digests in one batch, the guide and description workers together, then the checker, then the apply message to the guide worker through `$.session.send` to its agent id. The models are `userConfig` fields that default to these, for anyone who wants a cheaper build.
4. **No Bash or Write for workers.** They read with Read and hand their results to a `submit` tool the mod registers: `submit({ kind: "guide", json })` writes `guide.json`, runs `render.py --check` and returns its problems and warnings, the loop the guide prompt already describes. The checker gets `read_at_head(path)` in place of `git show`, limited to the PR's files. So no permission prompt appears mid-build, and nothing a PR description or issue talks a worker into reaches the shell. The tool refuses calls from the main conversation.
5. **Draw.** A new `render.py WORK --json OUT` writes the payload the page embeds (`dict(data, sections=..., **extras)`), and the pane draws from that. Which hunks each section holds, in what order, with every hunk placed once, is decided in Python (`build_sections`), as are moves and the ready check, so the pane and the page can't disagree. The `part` tag on a file split across sections and the "shown in §n" link on a gap are worked out today in the page's script from that placement; `--json` adds the hunk-to-section map so the pane draws them the same way.

Builds go under the clone's `.git/pr-review-guide/`, beside the build history `collect.py` keeps there already.

### The pane

`$.ui.open({ id: "guide", title })` opens it, and a `ui.render` hook on `{ component: "Pane", requestId: "guide" }` draws it from the desktop's elements: `Box`, `Text`, `Button`, `Input`, `Select`, `Svg`, `Link`, `Code`, `Markdown` and `Client`.

- **Only what is in view.** A tree draws at most 100,000 characters of text, so the pane shows one section at a time and pages a long one by file. A 3,000-line PR never has to fit at once.
- **Diffs** are `Code` with `format: "diff"`, which draws the gutters and the add and remove colours from unified hunks. `Code` is a leaf with no line events, so lines you can click need a `Client`: a module the surface itself runs, with its own state, pointer and key events, and `post` back to the hooks module. With `wrap: "truncate-end"` every line is one row, so the row clicked is the line. Notes, flags, annotations and findings show as rows under their lines.
- **Keys** while the pane has focus: `j` and `k` between hunks, `n` for a note, `r` to tick, `1` to `9` for a section (Button `hotkey`s take one digit or lowercase letter), and the arrows within a hunk (the Client's `onKey`).
- **Narrow by default.** A docked pane is narrower than the window, so diffs stay unified, as the page does below 860px. For a long read at full width, Open as page renders today's HTML page from the same build; notes sent from it reach the session as they do now, and the mod adds them to the pane's list.

### Notes and the chat

The message Claude reads keeps today's request and locations, adds an id to each note and names the tool to answer with:

```
pr-review-guide: 3 review notes on acme/app#123 at c3e8b96, each starting with its id and location.
Fix what they ask in the working tree and leave it unstaged; answer a question rather than change code.
For each one, call mcp__pr-review-guide__notes with op "resolve", its id, an outcome (fixed, answered
or declined) and one line on what you did.

n1 src/store/auth.ts:R42@c3e8b96
bail before the refresh, not after
```

It goes in with `$.prompt.submit`, which waits until the session is idle. A `UserMessage` hook on rows whose `origin.kind` is `plugin` and `origin.name` this one draws it as the card, while the stored row keeps the full text for the model. `$.ui.place` puts the summary card after the turn.

When a build finishes the mod adds one short user-role row with `$.session.append`, the section titles and the ready check in a line, so a question about "section 3" works without a tool call and nothing earlier in the conversation changes.

### CI

| Source | Gives | When |
| --- | --- | --- |
| `gh`, through `$.process.run` | status (`gh pr checks --json`); annotations (`gh api .../check-runs/{id}/annotations`, as `collect.py` reads them now); failing steps' logs (`gh run view --log-failed`); review threads (`gh api graphql`) | always; it runs as you |
| `session.receive` | `check_run`, `check_suite` and review events for a PR the session is subscribed to (Auto-fix subscribes; a cloud session subscribes when asked to watch the PR) | pushed; the mod reads them and passes each one on, never consuming it, so Auto-fix still gets them |
| `$.clock.every` | polling | while checks are pending |

`gh` is the one GitHub source. The session's GitHub connector isn't needed: `gh` reaches annotations, which none of the connector's tools offers, trims logs to the steps that failed, and is what the app's own PR status already relies on.

Logs, check output, review comments, PR descriptions and issues are other people's text. The digest quotes them as data, and the `ci` tool's answer marks them as such.

`$.process.run` doesn't ask you first, which suits reading. Every `gh` call that writes (a re-run, a reply, resolving a thread, posting a review, marking ready, editing the description, filing an issue) waits for your press and a `$.ui.ask` confirmation, or goes through Claude in the chat, where your usual permission prompts apply. The same holds for writes to Linear.

### Linear

Optional at every step, and never on the way to a guide.

- **Finding it.** The mod lists the session's tools (`$.tool.list()`) and takes the MCP server whose tools include Linear's `get_issue`, since the name depends on the host (`Linear` in a cloud session). No server means no Linear features, and no errors, prompts or empty panels about it. It looks once per session, and again after a call fails.
- **What it reads**, through `$.mcp.call`, which needs no prompt: each linked issue's title, description, state, team and parent, and its last few comments, for `issue.md` and the ready check; and whether the PR is in Linear diffs (`get_diff` answers for the PR's URL), which turns on Open in Linear (`linear.review/<owner>/<repo>/pull/<n>`) and makes the risk-score setting worth offering.
- **What it writes**, each behind your press and a confirmation: a follow-up issue from a note (0.4).
- **What it never does**: generate, read or show Linear's Guide; hold up a build waiting on Linear; or move an issue's status.
- **Trust.** Issue text and comments are other people's writing. The description checker already reads `issue.md` as claims to check, never as instructions.
- **Without the connector.** A Linear API key in the mod's settings (`userConfig`, stored as a secret) and `$.http.fetch` to Linear's GraphQL API would make the same reads. Worth adding only if the app's sessions often lack the connector.

### What Claude gets

Three tools, registered at `session.start` with `isDeferred: false` so they are listed from the first turn, each with a short description that never changes:

- `guide`: `outline` (sections, risk notes, ready check, linked issues), `section` (its text, files, hunk ids and notes), `hunk` (one hunk's diff), `focus` (moves the pane), `build` (for when you ask in words).
- `notes`: `list`, `resolve` (id, outcome, one line), and `add`, for Claude to leave you a note on a line it wants you to look at, marked as Claude's.
- `ci`: `status`, `failure`, `log`.

They are registered whether or not a PR is active, and say "no guide yet" when there is none. A tool list or description that changes partway through a conversation costs the prompt cache, and any thinking, from that point on.

### State

- `$.state`, declared in `types/index.d.ts`: the active PR, build progress, the view (tab, section, filters), notes, CI, findings, threads and linked issues. The pane and band draw from it, and it survives a hot reload.
- `$.store`, kept across sessions: unsent notes and ticks per PR. It holds 4 MiB of JSON in all, so it keeps the last 30 or so PRs.
- Disk, under `.git/pr-review-guide/`: builds and their history, which can run to megabytes.

### Four sketches

Notes going out, and coming back through Claude's tool call:

```tsx
const notes = atom({ plugin: 'pr-review-guide', key: 'notes' } as const, [], { shape: 'notes-1' })

async function send($, pr, picked) {
  await update($, notes, all => all.map(n => (picked.some(p => p.id === n.id) ? { ...n, state: 'sent' } : n)))
  await $.prompt.submit({ text: message(pr, picked) })
}

on('tool.call', { tool: 'mcp__pr-review-guide__notes' }, async ($, e) => {
  if (e.op === 'resolve') {
    await update($, notes, all => all.map(n => (n.id === e.id ? { ...n, state: e.outcome, reply: e.line } : n)))
    return { result: `${e.id} marked ${e.outcome}` }
  }
  return { result: listText(await read($, notes)) }
})
```

CI through `gh`:

```ts
async function checks($, pr) {
  const r = await $.process.run(
    ['gh', 'pr', 'checks', String(pr.number), '--json', 'name,state,bucket,link,workflow'],
    { cwd: pr.root },
  )
  return r.exitCode === 0 ? JSON.parse(r.stdout) : null // with --json, gh exits 0 even while checks fail or are pending
}
```

Linear when the session has it, and nothing when it hasn't:

```ts
async function linearIssue($, key) {
  const server = await serverWith($, 'get_issue') // the MCP server whose tools include get_issue, if any
  if (!server) return null // no Linear: the key stays listed, unfetched
  const r = await $.mcp.call(server, 'get_issue', {
    id: key, fields: ['title', 'description', 'status', 'url', 'team', 'parentId'],
  })
  return r.isError ? null : issueSection(key, r.content) // a Jira key Linear doesn't know ends here too
}
```

`/code-review` findings onto the guide, the app's own card untouched:

```ts
on('tool.call', { tool: 'ReportFindings' }, async ($, e, next) => {
  const ran = await next(e)
  await update($, findings, () => e.findings.map(pinToHunk))
  return ran
})
```

## Rules the API sets

- **100,000 characters of text per tree**, and as much again for a `Client`'s props: draw the part in view.
- **`Code` has no line events**: anything per line is a `Client`.
- **What a conversation has been sent stays as sent.** Tool descriptions and system prompt sections answer the same for a whole conversation; new context goes in as a new row at the end.
- **`$.ui.notify` doesn't reach the desktop app**, which has no terminal for it: use toasts.
- **`$.process.run` stops at 30 seconds** unless given `timeoutMs` (ten minutes at most), and runs git with the repo's hooks off.
- **`gh` has to resolve from the app.** A session the desktop app starts may not have your shell's PATH, and Homebrew puts `gh` in `/opt/homebrew/bin`. The mod tries the usual places and takes a path setting.
- **`$.session.repo()` names only repositories the build treats as its own**: parse `remote` for the owner and name.
- **Early access.** The declarations say the surface can change between releases. Keep the Python half free of the host, keep the skill working, and put the version the mod was tested on in the README.
- **Where it runs.** The public docs give the desktop Code tab from 2.1.286, in local sessions; the app doesn't offer plugin installs for cloud sessions or WSL. Build and test on a local session first.

## Build order

**M0, a spike, a day or two.** Prove what the plan leans on, on desktop and in a terminal:

- a docked pane drawing one section of a build made by today's scripts, its diffs as `Code`, and how wide the app docks it (`bodyColumns`), which decides whether long diffs read well there or the page stays the place for them;
- a `Client` drawing a 200-line hunk and saying which line was clicked;
- `gh` through `$.process.run` from a local desktop session: that it resolves on the app's PATH and runs as you (`gh pr checks --json` needs no check: `gh`'s source writes the JSON and returns before setting the exit codes for failed or pending checks, so it exits 0 either way, and `collect.py` reading a non-zero exit as no data is safe);
- `$.mcp.call` reaching the Linear connector when it is connected, and the mod staying quiet when it isn't;
- a pane button whose `$.prompt.submit` starts a turn, drawn as a card by a `UserMessage` hook;
- a registered Opus worker, hidden from the model, answering through a mod tool, and taking a second message (the apply step) once it has answered.

Whatever fails changes the plan before the rest is built. The likeliest is the `Client`; the fallback is a note per hunk, its line picked from a list.

**M1, the loop (0.2).** The pipeline as code with `--json` and `--pr N --head SHA`, linked Linear issues when Linear is there, the pane, notes out and back, rebuild, the band and the `guide` and `notes` tools. Done when the fixture repo builds a guide through the mod, `claude plugin test` passes on terminal and desktop, and a real PR goes round once in the app with Linear connected and once without: build, notes, fixes, rebuild.

**M2, CI (0.3).** Status, polling and events, annotations on lines, digests, the `ci` tool and the `ReportFindings` layer. Done when a PR with a failing lint shows the error under its line and Fix this check clears it in one turn.

**M3 (0.4) and M4 (0.5)** as listed above, in whichever order your reviewing needs.

## M0 findings

Run on 6 November 2026 with the mod in `spike/prg-spike/`, in a terminal on Claude Code 2.1.319 and in local desktop sessions. The desktop app (4.23118.0) runs its own bundled Claude Code, 2.1.317, not the 2.1.318 the plan was written against. The data is the fixture's build, copied into the mod, and each session wrote what it saw to `.git/prg-spike/<session id>.json`. `claude plugin test` runs 9 tests on terminal and desktop mounts and passes under both versions, but the kit passed two things the apps then didn't do (the card, and the tool for a worker spawned from a button), so it's no stand-in for trying it in the app.

**1. The docked pane** works on both. The title, risk, why and how draw as `Markdown` and the hunks as `Code` with `format: "diff"`. The terminal docks it at 89 of 124 columns. On the desktop `bodyColumns` means nothing: it reported 86, 121, 107 and 57 against viewports of 65, 32, 42 and 98 columns. Each `Code` there is a block as wide as its longest line, with a copy button and no line numbers, and a full-width `Box` around it doesn't stretch it, so a section's hunks come out at different widths. The guide's `[start with /blog](f3)` drew as a link, though the declarations say a link that isn't http, https or file draws as text.

**2. Clicking a line.** `Code` inside a `Client` doesn't draw on the desktop at any size (200, 20 or 5 lines): `ui.fault` with phase `render` and "returned a tree the page cannot draw (malformed or past its bounds)". The terminal draws it, and a click on row 10 came back as line 10. A `Client` that draws one `Text` per line with `wrap: "truncate-end"`, coloured `diffAdded` and `diffRemoved`, works on both: all 200 lines drew on the desktop and a click on row 3 came back as line 3, beside L003. The kit can't raise `ui.fault`, so the fallback is only testable in the app.

**3. gh** works from both. Bare `gh` resolves on the desktop session's PATH and runs as the logged-in account. `gh pr checks 2 --json name,state,bucket,link` exits 0 with 5 checks in 4.5 s in the terminal and 6.7 s on the desktop. One terminal run hung, but its timings say the Mac slept mid-call (a 60 s timeout firing at 594 s), and the next run passed. The mod now closes the child's stdin anyway.

**4. Linear** works when it's there and stays quiet when it isn't. The terminal session has `claude_ai_Linear`, found by its `get_issue`: `list_issues` and then `get_issue` on the key it returned answer in 2 to 3 s, and `ZZZ-99999` comes back `isError` with "Could not find referenced Issue", so a Jira key ends there as planned. The desktop sessions had no Linear connector at all (43 tools), and the mod made no calls and showed nothing.

**5. The notes turn** starts from a pane button on both, and the model reads it as "The prg-spike plugin sent a message: …". The `UserMessage` hook on `origin.kind: "plugin"` draws the card under the kit, but neither app uses it: the terminal draws its own "Prompt from the prg-spike plugin" row with the full text, and the desktop shows the whole message with the engine's own line about plugin prompts appended. Whether the hook isn't raised for these rows or its matcher misses them is still open.

**6. The worker** works when it's spawned from inside a model turn, and not when it's spawned from a pane button.

- `$.agent.register` with `model: "opus"` gives a `prg-spike:worker` on `claude-opus-5-5`, and the `agent.offer` hook kept it out of the model's listing. `$.agent.list()` doesn't say which model an agent runs on; only the spawn result does.
- From a button press in auto mode the spawn is refused, twice: "The server-side auto mode classifier gave no verdict for Agent: the request that produced this action did not ask for one". In ask-permissions mode it raises a permission prompt and runs once allowed. From a mod tool the model calls (`spawn_worker`), the spawn went through in auto mode with no prompt.
- A worker spawned from a button press or a `$.clock.after` timer can't reach the mod's own tool: "prg-spike registered the tool answer but no tool.call hook answered this call", and the hook logs no call. That held on 2.1.317 and 2.1.319. A worker spawned from `spawn_worker` on 2.1.319 had both its calls answered. Under the kit, a call carrying the worker's `agentId` is answered however it was spawned.
- `turn.complete` reaches the mod for each of the worker's turns, with its reply as `answer`, and `$.session.send` to its id delivers the second message, which the worker reads as from "the coordinator" and answers in a second turn. The whole round trip took 15 s.
- On 2.1.319 the worker ends with `SubagentHandback`, and each final reply also lands in the main conversation as a message to the main model.
- A send to a worker that had already finished failed with "is stopped (completed) and could not be resumed: Agent type 'prg-spike:worker' is not offered in this session". Resuming goes through `agent.offer`, so the spike lets its own resume through with a flag around the send. Every later send landed while the worker was still finishing, so the flag isn't proven for a stopped worker.

What the plan needs to change:

- Builds start inside a model turn: `/guide`, or the `guide` tool, spawns the workers from its own `tool.call`. A pane button that wants a build asks for one with `$.prompt.submit` instead of spawning. That gets past auto mode and keeps the `submit` tool, so the rest of the worker design stands.
- Workers keep their final reply to a word, since it reaches the main conversation; the real result goes through `submit`.
- Clickable lines are a `Client` drawing `Text` rows, not `Code` and not a line picker. Keep `Code` where nothing is clicked, and fall back to it on `ui.fault`.
- Size nothing from `bodyColumns` on the desktop.
- The notes message has to read well in full, since both apps show all of it.
- Linear was missing from every desktop session here, so the API key fallback under Open questions matters more than the plan assumed.
- Test against the app's bundled Claude Code, which lags the CLI. Its binary is under `~/Library/Application Support/Claude/claude-code/<version>/` and runs `claude plugin test` and `claude plugin validate` too.
- Edits didn't reliably reach an open desktop session; a new session always loaded them. The pane shows a build tag for that reason.
- With 800 or so MCP tools connected, the laid `claude-code-mcp` types are 1.2 MB and `tsc -p` runs out of memory. Type-check with a tsconfig that leaves them out.
- In the kit, an `agent.spawn` hook gets the Agent tool's input (`subagent_type`) rather than `AgentSpawnInput`, and can't hand back an `agentId`, so a test finds its worker through `agent.list`.

## Testing and the dev loop

- The Python self-tests, `tests/fixture.py` and the page's smoke test stay, with self-tests added for `--json` and for `--head` with `--pr`.
- `claude plugin test .` runs `*.test.tsx` against the engine. Mount the pane on `terminal` and `desktop` in one loop, press Send, and check the prompt that went out; answer `process.run` and `mcp.call` from the test to stand in for `gh`, the scripts and Linear; seed `state.get` with what an older version stored. Run the Linear tests both ways, with Linear's tools in the session's list and without, and check that without them nothing waits, asks or mentions Linear.
- `claude plugin validate .` and `tsc -p .` (the engine lays the types and a `tsconfig.json` beside a mod it loads) can run in CI beside the Python jobs, if `claude plugin test` runs there without a login. Check that first.
- In the desktop app, put `CLAUDE_CODE_PLUGIN_DIRS` (this repo's path) and `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` in the `env` of `~/.claude/settings.json`, so local sessions load the working copy and reload when you save. The README's install line stays; in the app it is + beside the prompt, Plugins, Add marketplace `veggiesaurus/pr-review-guide`, then Add plugin.

## Open questions

- **Click a line, or pick one?** A `Client` diff makes the better review, and the M0 spike says whether it can be built now. If not, notes go on hunks with a line picker, and the `Client` comes later.
- **Who settles disputes?** The plan has a fifth worker do it, so the conversation stays yours, and the pane lists each dispute and how it went so you can flip one. If you would rather the main conversation decide, as SKILL.md has it now, that becomes a turn the mod starts.
- **Threads on your PRs, or reviewing other people's?** If most of your reviewing happens in Linear on teammates' PRs, the reviewer mode in 0.5 may be worth more than the threads in 0.4.
- **Linear without the connector?** If the app's sessions often lack the Linear connector, the API key setting above is the fallback; if they have it, the connector alone is enough.
- **CI beyond Actions.** Other CI shows up through check runs and statuses, but `gh` reads logs only from Actions. Buildkite or CircleCI logs would need their own tokens.

## Sources

Read on 6 November 2026.

- The mod API: the declarations Claude Code 2.1.318 writes beside a mod it loads (`.claude-plugin/types/claude-code/index.d.ts`), and the plugin-authoring reference that ships with it.
- Claude Code: [desktop](https://code.claude.com/docs/en/desktop), [Code Review](https://code.claude.com/docs/en/code-review), [local review](https://code.claude.com/docs/en/code-review-local), [ultrareview](https://code.claude.com/docs/en/ultrareview), [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web), [mods overview](https://code.claude.com/docs/en/plugins/mods/overview), [mods reference](https://code.claude.com/docs/en/plugins/mods/reference).
- Devin Review: [Devin Review 2.0](https://devin.ai/blog/devin-review-2) (5 November 2026), [the launch post](https://cognition.com/blog/devin-review) (21 January 2026), [the docs](https://docs.devin.ai/work-with-devin/devin-review), [release notes](https://docs.devin.ai/release-notes/overview).
- Linear: [Reviews (diffs)](https://linear.app/docs/diffs), [the changelog](https://linear.app/changelog), [stacked pull requests](https://linear.app/changelog/2026-10-08-stacked-pull-requests), [mobile diffs](https://linear.app/changelog/2026-11-04-mobile-diffs), and Linear's MCP server's `get_issue`, `list_comments` and diff tools.
- `gh` commands the plan relies on: `pr view`, `pr checks`, `api` (check-run annotations, GraphQL review threads), `run view --log-failed`, `run rerun --failed`, `pr ready`, `pr edit`, `issue create`.
