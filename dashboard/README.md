# Dashboard

A small Bun server that serves the review page and reads GitHub, Linear and the local clone on the page's behalf. It also passes notes and chat between the page and the Claude Code session that started it. The skill starts it when Bun is installed; `SESSION.md` is what the session follows.

Built with Bun, Hono, zod, React, Vite, Tailwind 4, TanStack Query, ky, zustand and Biome, and styled with the tweakcn Claude theme.

## Running it

The skill does this for you. By hand:

```
bun install
bun run build
mkdir -m 700 -p ~/.cache/prg
bun run server/index.ts --state ~/.cache/prg/review.json --repo ~/repos/some-clone --data /path/to/collect-output
```

`--data` (required) is a folder `collect.py` or `stack.py` wrote, with its `guide.json` and the rest. The server runs the skill's `render.py` on it and serves the payload the skill's page would get, so every layer of a stack is there too. If `render.py` fails, as it does with no guide yet, the page gets the diff alone and `render.py`'s message. `--scripts` is the skill's `scripts/` folder (default: found from this one) and `--static` the built page (default `build/`). After rebuilding the folder, the session sends `POST /api/reload` with its token: the server loads it again and the page refetches. A reload that fails keeps what was there and returns the error.

The server listens on 127.0.0.1, on the port its last run had when that is still free (kept in a `.port` file beside the state file) and otherwise on one the OS picks, and writes `{port, token, origin, link, pid}` to the state file (mode 0600). Nothing secret goes to stdout. `link` is what you open in a browser, and it works once: the browser that opens it becomes the owner, and a copy of it opened later gets nothing. Share, Open on another device, makes a new single-use link for a phone or a second browser. `token` is what the session uses. Both are new on every start; keeping the port is what lets the browser keep the theme and the palette, which it stores per address. Keep the state file in a folder only you can read rather than straight in `/tmp`. It stops itself after an hour with nothing connected (`--idle-minutes`).

`--host ADDRESS` also listens on that address of this machine (its Wi-Fi address, say) and writes `lanLink`, with a single-use code of its own, to the state file, so a phone on the same network can open the page. It is off by default and plain HTTP: anyone on that network who sees the link can read the review and send notes to the session, so use it for a try and restart without it.

It needs `git` and `gh` on the path, and `gh` logged in. `LINEAR_API_KEY` is optional and a read-only key is enough. The key stays in the server, only ever goes to `api.linear.app`, and isn't passed to `git` or `gh`.

`SESSION.md` is what the Claude session needs (starting it, listening, every frame and answer). `CONTRACT.md` describes the payload, the API and how the code is split up.

## What the page does

Everything the skill's page does, in three tabs that all take the width of the window:

- Overview has the PR's details and description, the "Before you mark it ready" checks, the stack panel, the live panel and your notes. The checks are one list, each row with a dot: red where something is wrong, amber where there is something to look at, green once it is settled, as its chip in the header is coloured.
- Guide walks the sections, with the section text sticky on the left and its file cards on the right. Each section has a counter (`01 / 03`) and a Reviewed tick, and a thin rail at the left edge shows where you are. A thing to try by hand shows in the section its link points into, with what Claude found when it tried it.
- Diff is every file in one list.

Diffs are unified or split, with formatting-only lines hidden unless asked for, moved blocks shown once, CI annotations under their lines, "N unchanged lines" expanders, and a filter for what's new since the last build or one commit, each commit listed with its author, date and size. Clicking a name in a changed line of code lists the lines that use it on the PR's branch (not in markdown, JSON, YAML or TOML, or in anything generated). Reviewed ticks are per file and per section and are kept by the server. A card ticked before its code changed says so, marks the hunks that are new and dims the ones already read. Each section names whoever else has reviewed all of it, and a tick lapses when its code changes, so a second look does too. `u` asks the same of a name you type. Shift-click the theme button to pick another tweakcn palette (colours, corner radius and fonts), which is remembered in the browser. Its fonts come from Google Fonts through the server, so the page itself still asks no other host for anything; `bun run palettes` fetches the list again. `?` lists the keys (`j`/`k` files, `n`/`p` sections, `r` reviewed, `1` `2` `3` tabs).

On a stack a dropdown in the header picks the layer, and the stack panel at the top of the Overview lists each layer with its checks and what the stack check found, including a layer that needs a rebase or conflicts with its base. The layer, the tab and the last file or line jumped to are in the URL, so Back works and a link can point at one file.

The live panel shows the PR's state, conflicts, checks and reviewers from GitHub, including checks the trunk's rules require that nothing has reported, and a card for each Linear issue the PR names. Checks are polled only while a page is open: every 20 s while they run, every 3 minutes once settled, every 10 minutes for a closed PR. A switch (off by default) tells the Claude session when checks finish or one fails.

Any PR, issue, commit or Linear key in the PR's own text or Claude's replies is a link with a preview card on hover: state, author and labels for GitHub, and state, priority, assignee, estimate, project, cycle, labels, due date, parent and sub-issues for Linear. The server only looks up references that text holds, never one the page asks for. Profile pictures come through the server, so the page never sees their address and the CSP stays at `img-src 'self' data:`.

## Talking to Claude

The session listens by arming Monitor on `bun scripts/listen.mjs STATE.json`, which prints each frame and tells the server it arrived; Monitor's `ws` source on `ws://127.0.0.1:<port>/api/session/ws?t=<token>` works too, but a frame then only counts as delivered at the session's next request. A frame the session isn't heard from after goes again, through a restart too. Each thing the page sends arrives as one notification:

- chat goes straight away, from the drawer or from any "Ask Claude" button (a line, a hunk, a file, a section, a check), and carries what it's about
- screenshots dropped or pasted into a note or a chat box go with it, and the session reads them from disk
- posts go to the thread for everyone on the review and never to Claude, and say "Not sent to Claude". The next time someone asks Claude in that thread, its frame quotes the posts made since Claude last heard from it
- notes are drafts on the page until "Send N notes to Claude", then go as one batch for Claude to work through

The note and chat boxes format markdown as it is typed (`code`, _emphasis_, lists, and a code block from ``` and a language followed by a space or Enter) and send markdown; a sent code block is coloured by its language. The chat boxes send on Enter, with Shift+Enter for a new line and Enter making a new line inside a code block; the note box keeps Enter for a new line, ⌘↵ for a note and ⇧↵ (or ⇧⌘↵) to send to Claude straight away, and ⌘↵ sends from either. `@` in any box lists the owner and the guests let in, and a mention is stored as plain `@login` or `@Name`. It shows highlighted, more strongly for you, and the notes panel groups mentions with the unread ones first. A mention that arrives while you're on the page shows a small card with Jump to. One in a draft stays private until it's sent. A `:` and two letters opens an emoji picker, and a typed `:thinking:` turns into the emoji once the list has loaded, which happens on first use.

While the session is stopped at a permission prompt, the bar at the bottom of the page shows it with Allow and Deny buttons, for the owner only. They work on this machine and on the phone link (`--host`) but not through the share link, since the tunnel is open to the internet and an Allow gets past your `ask` rules; there the bar says to answer on this computer or in the terminal. Answering in the terminal works as before and clears the bar.

Claude answers with `POST /api/replies` and the bearer token, and the reply shows up in the thread on the page. While it works it can say what it's doing with `POST /api/activity`, which the page shows in its bottom bar and under the thread, and a thread waiting on an answer shows one of Claude Code's verbs ("Contemplating…") until it does. A note's `state` shows it as being worked on, done, answered or declined. If nothing is listening the page says so and keeps the messages until a session connects. When messages have waited 30 seconds with nothing listening, the server writes once to the session's inbox socket asking it to arm the listener again, and does so again only after the next lapse. A server left running by an earlier session points at an inbox that's gone and does nothing.

"Have Claude try them" on the Try by hand list asks the session to carry out each step. Its answer shows under the step as passed, failed or couldn't try, with what it ran and any screenshot, and is marked as from before the latest changes once a rebuild moves the head.

"Ask Claude for a review" on the Overview asks the session to run the code-review skill on the PR at medium effort, or at any effort from low to xhigh from the menu joined to the button. The findings come back as threads Claude starts, each on its line and tagged with its severity, with a recommendation on which to act on. The button stays an outline until you've ticked every section, since a review read first narrows where you look. Fix this on a finding sends it to Claude, who marks it done, and Fix the recommended sends every recommended one at once; a finding can carry the few lines Claude proposes to change. Dismiss asks why (false positive, intentional or fix later), and later reviews of the same repo are told what was dismissed as wrong or intended, and to read the repo's `REVIEW.md` if it has one. A rebuild at a new head sends every open finding back to be checked again and marks as outdated any whose code is gone. The review lists its findings by where they stand, and a whole review archives at once from the thread list. Nothing is posted to GitHub.

The diff is the pull request as pushed. Where the checkout's code differs from it (unpushed commits, a rebase, or uncommitted edits such as a fix Claude has just made), the first line affected carries a small eye button. Pressing it shows the checkout's code there in place of the reviewed lines, and the button on the previewed lines puts the reviewed code back on the page. A second button there reverts that one change in the checkout itself, after asking, and tells the session. The page looks for such differences every few seconds. In a stack, a layer whose branch isn't checked out uses the checkout of the nearest layer above it that is, for the files no layer in between changes, since that is where the work usually happens.

Messages and reviewed ticks are kept in `prg.db`, a SQLite file in the state file's folder shared by every review started there, each thread with the PR it is about and, in a stack, the stack's number on GitHub. A restart brings them back, a thread shows wherever its PR or its stack is reviewed, and a tick made on one device shows on another. After a reload each thread finds its line again by its code, or is marked as no longer in the diff.

The PR's existing review threads show under their lines, read-only. With `--github-comments` you can also post your notes to the pull request as one review. A dialog first shows exactly what would go, on which commit and under whose login, and it defaults to a pending review. Without the flag the posting routes answer 403. There is no merge button.

## Who can call it

The session holds a bearer token. The page holds two things: an HttpOnly cookie the link sets the first time it is opened (kept for 30 days, and useless once the server restarts), and the link's code, which it keeps in the browser's storage for that address and sends with every call. The API wants both, since a cookie alone goes to every port on 127.0.0.1 and another local server could replay it. The cookie by itself only gets the page's files and pictures. Host and Origin are checked on every request, and only a caller with a credential keeps the server from going idle.

The link's code works once: the first browser to open it gets the cookie, and an opening without that cookie is refused after that. A second tab or a re-click in the same browser still works.

Text from the PR that ends up in a frame to the session (a file path, a check's name) has its line breaks flattened, so it can't pass itself off as a frame or an instruction of its own.

## Sharing

`POST /api/share`, or the Share button, starts `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:PORT` and reads the `https://*.trycloudflare.com` address from its output. The link is that address with `/?g=CODE`, and it goes in the state file as `shareLink`. Stopping ends the tunnel and every guest's session. A new share is a new address, so guests sign in again.

With a public client id from an OAuth app the owner registers (`--github-client-id`, which the skill fills from the plugin's settings, else `PRG_GITHUB_CLIENT_ID`), guests sign in with GitHub's device flow. The server asks for no scope, reads the user's public profile, throws the token away, and checks with the owner's `gh` that the user is a collaborator on the reviewed repo (`gh api repos/acme/shop/collaborators/alice`). Sharing is refused if the owner's `gh` can't make that check. GitHub allows 50 code submissions an hour per app, across all its users.

Without a client id, guests type a name instead, and nothing checks it's theirs or that they can see the repo. The session's frames mark them as `from guest "Name" (typed name)`, and at most 20 can wait at once.

Either way a guest then waits in the Share popover until the owner lets them in, with the country and browser the sign-in came from and a 4-digit code that their page shows too. The owner can check the code with them before letting them in, so someone else with the link, or someone tricked into entering a sign-in code, can't get in unnoticed.

`--allowed-mail` (the plugin's allowed emails setting), else `PRG_ALLOWED_MAIL`, adds Cloudflare's email gate in front of the page. It doesn't work with the dashboard yet: the gate's session cookie lapses soon after the PIN, and once it has, the gate redirects every API call and the live socket to its login page, which `fetch` and WebSockets can't follow. It needs `cloudflared` 2026.11 or later, and `cloudflared` doesn't pass the email on, so guests are still identified by GitHub or the name they type.

Guests can chat, post, mention people, leave notes and tick their own sections. Their notes, drafts and unseen answers are their own, and who has ticked which section shows to everyone. A guest is there for a second look, so their page lists the sections with a careful-read note and how many sections the owner has reviewed, and starts with the cards the owner has ticked folded in any section that has no such note. Review requests, having Claude try the steps, Fix the recommended, posting to GitHub, the local-changes preview, archiving and sharing are the owner's, and the server refuses a guest on each. Rebuild and Fix this are owner's buttons too, but they send ordinary chat text that a guest could type, so the session acts on them only when the frame says it came from the owner, as `SESSION.md` says. Quick tunnels have no uptime guarantee and the address is only as private as the link, so share it only with people you'd show the review to.

## Checking it

```
bun test
bun run typecheck
bunx biome check .
bun tests/smoke.mjs [STATIC_DIR]
bun tests/shot.mjs STATE OUT_DIR [light|dark] [WIDTH] [HASH]
```

`smoke.mjs` walks the page in headless Chromium against a fresh fixture and fails on any console error, page error or CSP violation. `shot.mjs` takes a full-page screenshot of a running server's page under the same rule.

## Not done, or not tried

- Posting to GitHub has only run against a stand-in for `gh`, never against GitHub, so GitHub's own answers to it (a review with no summary, a line it refuses) are untested.
- Only Chromium has been tried. Not WebKit or Firefox, not a touch device, and not the desktop app's browser pane.
- Not tried with a real Monitor on the socket, with the session idle when a message arrives, or across Monitor's 30-minute expiry.
- The hover cards don't open on touch. The card in the live panel shows the same details.
- A GitHub issue's preview card, a reviewer list with pictures, the conflict and behind states and deployment previews haven't been seen against a real PR that has them. Nor have the overdue, urgent and milestone parts of the Linear card.
- In the Guide, a thread on an unchanged line between two hunks that sit in different sections can't show under its line. It's still in the Diff tab and the notes panel.
- Pressing `j` in the same instant as `r` lands the next card about 250px above the window.
