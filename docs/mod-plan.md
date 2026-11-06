# A desktop mod for the review guide

A plan for turning the pr-review-guide skill into a mod: a plugin whose hooks module draws a pane beside the chat in the Claude desktop app's Code tab, puts your notes into the conversation and keeps CI in view. It covers what the mod should do, what it should leave to the app, and how to build it. It was written against the mod API of Claude Code 2.1.318 (early access, so names may move), the skill as it stands in this repo, the current Claude Code docs, Linear's diffs docs and Cognition's Devin Review posts.

## The short version

Keep the plugin and add a hooks module to it. The Python scripts stay the engine. Four things change.

1. **The guide is a pane beside the chat**, not a browser tab: the ready check, the sections and their diffs, ticks and notes, with the chat usable while you read.
2. **Notes go into the chat as a turn**, and Claude resolves each one through a tool, so the pane shows what was fixed, answered or declined and offers the rebuild. No comment threads, 4 KB parts, consent prompts or watching session.
3. **The mod runs the pipeline as code.** It runs `collect.py`, spawns the digest, guide, description and check workers as agent types it registers, with the models and efforts SKILL.md names today, and checks what each hands back. The conversation stays yours.
4. **CI comes in live**: check status from the session's GitHub connector or `gh`, lint and type errors under their lines, a digest of each failing job tied to the section it breaks, and a `ci` tool Claude calls when you ask why the build is red.

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

- **Linear's Guide is for the reviewer, in Linear. This one is for you, before anyone looks**, and does what Linear's doesn't: the description checked claim by claim, flagged lines, the ready check, what is new since the last build, and CI on its lines.
- **CI is the gap.** Linear shows status only; Devin puts logs in its chat's reach. The mod can do both, inside the conversation that will fix the code.
- **Worth taking:** a lines-left counter, quoting a line into the chat, counting a note resolved only when its code changed, rebuilds that redo only what changed, a guide before the PR exists, and threads shown in the guide. Each is in the feature set below.
- **Worth leaving:** a bug finder with severities, and an autofix loop. In the app, `/code-review` and Auto-fix cover those.

## The feature set

Each release works on its own. The first is the loop the skill already has, moved into the app; the second is CI; the rest widen it.

### 0.2: the loop, in the app

- **Build from the chat.** `/guide`, `/guide 123`, `/guide stack`, or asking in words, which reaches a `guide` tool. A branch with no PR yet works too, uncommitted changes included, as Linear's coding sessions show theirs. The pane opens and shows each step as it runs (collecting, 3 digests, writing sections, checking, settling 2 disputes), about two minutes for a 600-line PR, and you can keep talking to Claude meanwhile.
- **The pane.** A header with the PR, its size band and CI, then four views: Ready, Sections, Notes and CI. A section shows its title, risk note, why and how (their links jump to hunks), then its files and hunks, with formatting hidden unless asked, moves folded and flagged lines marked. Reviewed ticks per file and section, kept across rebuilds by hunk signature as now.
- **Notes on lines.** Click a line and type; the note is kept in the session, and across sessions until sent. Its location is `path:R<n>@<sha>` as today plus the line's text, so it finds its line again after a rebuild (Linear keeps an `anchorContent` on its diff drafts for the same reason).
- **Send to Claude.** Send N notes starts a turn holding them all, drawn in the transcript as one card. Put in prompt puts the same text in the prompt box instead, for adding context first. Claude answers each note through the `notes` tool with fixed, answered or declined and one line, and the note changes in the pane as it does. When the turn ends, a card under it sums up ("4 fixed, 1 answered") with Rebuild and Open guide.
- **Rebuild.** After a turn that edited files in the PR, the band offers a rebuild. It can take in uncommitted fixes: the mod builds from a commit object made through a temporary index (`GIT_INDEX_FILE`), which leaves the working tree and the index alone, and with `--meta` naming the PR the build history stays under the PR's key. The pane then marks what is new since the last build and keeps the ticks on unchanged cards. A note Claude marked fixed whose lines did not change is flagged rather than closed, as Devin Review counts a finding resolved only when code fixed it.
- **Ask about a part.** Ask, on a section or hunk, or `q` on a line, fills the prompt with a reference ("About §3 Reset tabs after a switch, f9h2: ") and leaves the question to you, as Devin's Quote in chat does. Claude reads that part through the `guide` tool rather than holding the whole guide in context.
- **Claude can point.** `guide` with `focus` moves the pane to a section, hunk or line, so "where does the token get re-minted?" ends with the pane on it.
- **The pane follows Claude.** While Claude reads or edits a file in the PR, the pane marks the section it is in, and each Edit row in the transcript names the note or section it touches (a `tool.call` hook to watch, a `ToolUse` hook to draw).
- **A band above the prompt** while the branch has a PR: `#123 · CI 1 failing · 5 notes · 212 lines left to review`, with Guide, Send notes and Rebuild. A status line entry says the same in brief.

### 0.3: CI

- **Live status.** Check runs and commit statuses for the PR head, refreshed every 20 seconds while any are pending (every 60 after five minutes), and at once when a `check_run` or `check_suite` event reaches the session. A toast when the last one finishes; the band and status line follow.
- **On the lines.** Annotations, the lint, type and test errors a check pins to a line, show under that line in the diff, and those outside the diff in the ready check, as the page does now.
- **Stale CI.** When CI ran on an older head than the build, the ready check says how many commits behind and which sections changed since.
- **Failure digests.** For a failing check: the failing step, the error lines and any `path:line` they name, tied to the hunks and sections they hit. Parsed rather than summarised, for the common formats (tsc, eslint, ruff, mypy, pytest, jest, go test, cargo), with a one-line Haiku summary only when nothing parses.
- **Act on it.** Fix this check starts a turn with the digest; Ask puts it in the prompt; Re-run failed jobs asks you first.
- **A `ci` tool for Claude**: `status`, `failure` (the digest) and `log` (a tail, filtered and capped), so "why is CI red?" costs a few hundred tokens rather than a raw log.
- **`/code-review` findings in place.** The mod reads `ReportFindings` on its way to the app's card and pins the same findings to their hunks, as a layer you can hide. One press turns a finding into a note.
- **Rebuilds that redo only what changed.** After a round of small fixes, the guide worker gets the last guide and the new or changed hunks rather than the whole diff, and the checker reads only the sections they touch. Devin Review 2.0 re-reviews only what changed after a push for the same reason: cost and time.

### 0.4: threads and finishing

- **Reviewer threads in the pane**: GitHub review threads, Managed Code Review's comments, and Linear diff threads when the PR is in Linear, each on its line with its state.
- **Address threads** sends the threads you pick to Claude the way notes go, answered through the same tool. Replying and resolving on GitHub or Linear is a separate press, with a confirmation, using the line Claude wrote; the reply carries Linear's `onBehalfOf` block naming Claude, so Linear shows who wrote it.
- **Fix the description.** The description check's mismatches go to Claude, which drafts a new description and posts it only when you say so: its own GitHub tool call, with the usual permission prompt.
- **Mark ready** once the ready check is clean, behind a confirmation.

### 0.5: stacks, sharing, other people's PRs

- **Stacks in the pane**: the layer list with ↑ and ↓, cross-layer links and the stack check, from `stack.py` as now.
- **Share as page**: `render.py` writes the HTML and the mod publishes it with the Artifact tool, one page per PR as `artifacts.json` keeps it now.
- **Reviewing someone else's PR**: the same guide, with your notes posted as a GitHub review or as Linear diff drafts and then submitted, when you say.
- **Risk notes for reviewers in Linear.** Linear shows a risk score that a tool leaves on the PR as a `linear:extension` block in an HTML comment (`riskScore`, level 1 to 4, up to eight explanations of 200 characters, optionally pinned to a sha). The guide's risk notes fit that shape, so your reviewers would see them in Linear's own view; an extension-only comment stays out of Linear's activity feed.

### Left out on purpose

- **Finding bugs in the guide workers.** The guide describes and groups; findings come from `/code-review` or Managed Code Review, as SKILL.md's common mistakes already says.
- **Fixing CI unasked.** Auto-fix does that, and two agents acting on one red build is worse than one.
- **Merging, reviewers and labels**: the app and GitHub have those.
- **Mobile and VS Code** beyond the band and status line, until the desktop pane is right.

## How it is built

### One plugin, two halves

The repo is already a plugin. The mod adds a hooks module next to the skill, and nothing moves.

```
.claude-plugin/plugin.json    adds "types", and userConfig for models and CI polling
hooks/hooks.json              { "modules": ["./register.tsx"] }
hooks/register.tsx            wiring: session.start, commands, tools, agent types, events
hooks/pipeline.ts             find the PR, collect, workers, check, settle
hooks/ci.ts                   sources, polling, events, digests
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

1. **Find the PR.** `$.session.repo()` gives the root and the origin URL, `git rev-parse` through `$.process.run` the branch, and the GitHub connector or `gh pr view` the PR. It runs at `session.start` and again at each `turn.complete` that could have switched branches, so the band is right before any build.
2. **Collect.** The mod fetches the PR's fields, check runs, annotations and linked issues itself and hands them to `collect.py` in a new `--meta FILE`, so `collect.py` no longer needs `gh` when the mod drives it; without the flag it calls `gh` as now. Linear and Jira issue text comes from those connectors the same way. `$.process.run` stops at 30 seconds unless given `timeoutMs`, so pass two minutes.
3. **Workers.** Five agent types, registered at `session.start` with `$.agent.register` and each hidden from the main model by an `agent.offer` hook: digest (Haiku), guide (Opus, medium), description (Opus, default), check (Opus, medium), and settle (Opus), which takes the main conversation's place as the tie-break on disputes. The mod spawns them as SKILL.md does: the digests in one batch, the guide and description workers together, then the checker, then the apply message to the guide worker through `$.session.send` to its agent id. The models are `userConfig` fields that default to these, for anyone who wants a cheaper build.
4. **No Bash or Write for workers.** They read with Read and hand their results to a `submit` tool the mod registers: `submit({ kind: "guide", json })` writes `guide.json`, runs `render.py --check` and returns its problems and warnings, the loop the guide prompt already describes. The checker gets `read_at_head(path)` in place of `git show`, limited to the PR's files. So no permission prompt appears mid-build, and nothing a PR description or issue talks a worker into reaches the shell. The tool refuses calls from the main conversation.
5. **Draw.** A new `render.py WORK --json OUT` writes the payload the page embeds (`dict(data, sections=..., **extras)`), and the pane draws from that. Section assembly, file parts, gaps, moves and the ready check stay in Python, so the pane and the page can't disagree.

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
| The GitHub connector, through `$.mcp.call` | check runs, commit statuses, failed jobs' logs (`get_job_logs` with `failed_only` and `tail_lines`), a check run's output text, review threads | wherever the session has it; no permission prompt |
| `gh`, through `$.process.run` | the same, plus annotations (`check-runs/{id}/annotations`), which none of the connector's tools offers | local sessions where `gh` is logged in |
| `session.receive` | `check_run`, `check_suite` and review events for a PR the session is subscribed to (Auto-fix subscribes; a cloud session subscribes when asked to watch the PR) | pushed; the mod reads them and passes each one on, never consuming it, so Auto-fix still gets them |
| `$.clock.every` | polling | while checks are pending |

The connector's server name depends on the host (`github` in a cloud session; in the app, whatever name the GitHub connector or local server was given), so the mod lists tools with `$.tool.list()` and takes the server whose tools include `pull_request_read`.

Logs, check output, review comments and PR descriptions are other people's text. The digest quotes them as data, and the `ci` tool's answer marks them as such, as the GitHub connector does with its `untrusted_external_data` envelope.

`$.mcp.call` doesn't ask you first, which suits reading. Everything that writes (a re-run, a reply, resolving a thread, posting a review, marking ready, changing the description) waits for your press and a `$.ui.ask` confirmation, or goes through Claude in the chat, where your usual permission prompts apply.

### What Claude gets

Three tools, registered at `session.start` with `isDeferred: false` so they are listed from the first turn, each with a short description that never changes:

- `guide`: `outline` (sections, risk notes, ready check), `section` (its text, files, hunk ids and notes), `hunk` (one hunk's diff), `focus` (moves the pane), `build` (for when you ask in words).
- `notes`: `list`, `resolve` (id, outcome, one line), and `add`, for Claude to leave you a note on a line it wants you to look at, marked as Claude's.
- `ci`: `status`, `failure`, `log`.

They are registered whether or not a PR is active, and say "no guide yet" when there is none. A tool list or description that changes partway through a conversation costs the prompt cache, and any thinking, from that point on.

### State

- `$.state`, declared in `types/index.d.ts`: the active PR, build progress, the view (tab, section, filters), notes, CI, findings and threads. The pane and band draw from it, and it survives a hot reload.
- `$.store`, kept across sessions: unsent notes and ticks per PR. It holds 4 MiB of JSON in all, so it keeps the last 30 or so PRs.
- Disk, under `.git/pr-review-guide/`: builds and their history, which can run to megabytes.

### Three sketches

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

CI from the connector, then `gh`:

```ts
async function checkRuns($, pr) {
  const server = await githubServer($) // the server whose tools include pull_request_read
  if (server) {
    const r = await $.mcp.call(server, 'pull_request_read', {
      method: 'get_check_runs', owner: pr.owner, repo: pr.repo, pullNumber: pr.number,
    })
    if (!r.isError) return fromConnector(r.content)
  }
  const r = await $.process.run(['gh', 'pr', 'checks', String(pr.number), '--json', 'name,state,bucket,link'], { cwd: pr.root })
  return r.exitCode === 0 ? fromGh(r.stdout) : null
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
- **`$.session.repo()` names only repositories the build treats as its own**: parse `remote` for the owner and name.
- **Early access.** The declarations say the surface can change between releases. Keep the Python half free of the host, keep the skill working, and put the version the mod was tested on in the README.
- **Where it runs.** The public docs give the desktop Code tab from 2.1.286, in local sessions; the app doesn't offer plugin installs for cloud sessions or WSL. Build and test on a local session first.

## Build order

**M0, a spike, a day or two.** Prove what the plan leans on, on desktop and in a terminal:

- a docked pane drawing one section of a build made by today's scripts, its diffs as `Code`, and how wide the app docks it (`bodyColumns`), which decides whether long diffs read well there or the page stays the place for them;
- a `Client` drawing a 200-line hunk and saying which line was clicked;
- `$.mcp.call` reaching the GitHub connector from the mod in a local desktop session, and `gh` through `$.process.run`;
- a pane button whose `$.prompt.submit` starts a turn, drawn as a card by a `UserMessage` hook;
- a registered Opus worker, hidden from the model, answering through a mod tool, and taking a second message (the apply step) once it has answered.

Whatever fails changes the plan before the rest is built. The likeliest is the `Client`; the fallback is a note per hunk, its line picked from a list.

**M1, the loop (0.2).** The pipeline as code with `--meta` and `--json`, the pane, notes out and back, rebuild, the band and the `guide` and `notes` tools. Done when the fixture repo builds a guide through the mod, `claude plugin test` passes on terminal and desktop, and a real PR goes round once in the app: build, notes, fixes, rebuild.

**M2, CI (0.3).** The sources, polling and events, annotations on lines, digests, the `ci` tool and the `ReportFindings` layer. Done when a PR with a failing lint shows the error under its line and Fix this check clears it in one turn.

**M3 (0.4) and M4 (0.5)** as listed above, in whichever order your reviewing needs.

## Testing and the dev loop

- The Python self-tests, `tests/fixture.py` and the page's smoke test stay, with self-tests added for `--meta` and `--json`.
- `claude plugin test .` runs `*.test.tsx` against the engine. Mount the pane on `terminal` and `desktop` in one loop, press Send, and check the prompt that went out; answer `mcp.call` and `process.run` from the test to stand in for GitHub and the scripts; seed `state.get` with what an older version stored.
- `claude plugin validate .` and `tsc -p .` (the engine lays the types and a `tsconfig.json` beside a mod it loads) can run in CI beside the Python jobs, if `claude plugin test` runs there without a login. Check that first.
- In the desktop app, put `CLAUDE_CODE_PLUGIN_DIRS` (this repo's path) and `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` in the `env` of `~/.claude/settings.json`, so local sessions load the working copy and reload when you save. The README's install line stays; in the app it is + beside the prompt, Plugins, Add marketplace `veggiesaurus/pr-review-guide`, then Add plugin.

## Open questions

- **Click a line, or pick one?** A `Client` diff makes the better review, and the M0 spike says whether it can be built now. If not, notes go on hunks with a line picker, and the `Client` comes later.
- **Who settles disputes?** The plan has a fifth worker do it, so the conversation stays yours, and the pane lists each dispute and how it went so you can flip one. If you would rather the main conversation decide, as SKILL.md has it now, that becomes a turn the mod starts.
- **Threads on your PRs, or reviewing other people's?** If most of your reviewing happens in Linear on teammates' PRs, the reviewer mode in 0.5 may be worth more than the threads in 0.4.
- **CI beyond GitHub.** Other CI shows up through check runs and statuses, but logs come only from Actions. Buildkite or CircleCI logs would need a token in `userConfig` and `$.http.fetch`.

## Sources

Read on 6 November 2026.

- The mod API: the declarations Claude Code 2.1.318 writes beside a mod it loads (`.claude-plugin/types/claude-code/index.d.ts`), and the plugin-authoring reference that ships with it.
- Claude Code: [desktop](https://code.claude.com/docs/en/desktop), [Code Review](https://code.claude.com/docs/en/code-review), [local review](https://code.claude.com/docs/en/code-review-local), [ultrareview](https://code.claude.com/docs/en/ultrareview), [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web), [mods overview](https://code.claude.com/docs/en/plugins/mods/overview), [mods reference](https://code.claude.com/docs/en/plugins/mods/reference).
- Devin Review: [Devin Review 2.0](https://devin.ai/blog/devin-review-2) (5 November 2026), [the launch post](https://cognition.com/blog/devin-review) (21 January 2026), [the docs](https://docs.devin.ai/work-with-devin/devin-review), [release notes](https://docs.devin.ai/release-notes/overview).
- Linear: [Reviews (diffs)](https://linear.app/docs/diffs), [the changelog](https://linear.app/changelog), [stacked pull requests](https://linear.app/changelog/2026-10-08-stacked-pull-requests), [mobile diffs](https://linear.app/changelog/2026-11-04-mobile-diffs), and Linear's MCP server's diff tools.
- The GitHub connector's tools as this session lists them: `pull_request_read`, `get_check_run`, `get_job_logs`, `actions_list`, `actions_get`, `actions_run_trigger`, `update_pull_request`.
