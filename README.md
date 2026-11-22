# pr-review-dashboard

A Claude Code plugin that turns a pull request into a dashboard for reviewing your own work before anyone else does. The diff is split into logical sections, each with why it exists and how it works, and formatting and generated files are kept out of the way. The dashboard runs on your machine beside your Claude session: notes and questions you leave on lines reach the session as you send them, its answers show in the thread, and the PR's checks and Linear issues stay live.

It's much like Linear's [Guide](https://linear.app/docs/diffs#guides) tab, but it's built locally from the diff, so it works the same whether your team tracks work in Linear, Jira or GitHub issues. It also opens with what to settle before marking the PR ready: size, CI, missing tests, lines that look like an agent's leftovers, the description and linked issue checked claim by claim against the diff, a few things to try by hand, and whether the PR should be split.

Once Claude has worked through your notes, press Rebuild and the dashboard shows what's new since the last build, keeping your threads and your ticks on the files that didn't change. Code that only moved shows as a move, CI's lint and type errors sit under their lines, and you can read the diff side by side or one commit at a time.

## Install

```
/plugin install pr-review-dashboard --marketplace veggiesaurus/pr-review-dashboard
```

Or add the marketplace first with `/plugin marketplace add veggiesaurus/pr-review-dashboard`, then `/plugin install pr-review-dashboard@pr-review-dashboard`. To use it without the plugin system, copy `skills/pr-review-dashboard` into `~/.claude/skills/`; that gets you the static page only, since the dashboard needs the whole plugin.

Then ask Claude for a review of a PR ("build a review dashboard for #123") or of the current branch. The first run installs the dashboard's packages and builds it.

## Update

Refresh the marketplace, then the plugin, and restart Claude Code:

```
claude plugin marketplace update pr-review-dashboard
claude plugin update pr-review-dashboard@pr-review-dashboard
```

Each version installs into its own folder, so the first review after an update installs the dashboard's packages and builds it again. A dashboard that's already running stays on the old version until it's started again.

## Configuration

The plugin has two settings, both only for sharing. Claude Code asks for them when you install it, and you can change them later with `/plugin configure pr-review-dashboard@pr-review-dashboard` or in `/config`:

- GitHub OAuth app client id: optional, the app guests sign in with when you share a review (see Sharing). Without it they type a name instead.
- Emails allowed into a shared review: an optional comma-separated list such as `alice@acme.com,*@acme.com`. Cloudflare then asks guests for an email one-time PIN before the page loads. Leave it empty for now: Cloudflare's session for a guest lapses soon after the PIN, and the page's background requests can't renew it, so guests get stuck.

A change reaches the next review you ask for, not one that's already running. `PRG_GITHUB_CLIENT_ID` and `PRG_ALLOWED_MAIL` in the environment still work when a setting is empty.

Linear issues need `LINEAR_API_KEY` in the environment Claude Code runs in, exported from your shell profile before starting `claude`. A read-only key is enough, and it only ever goes to `api.linear.app`. It isn't a plugin setting because Claude Code can't hand a secret setting to the dashboard without putting it in the environment of every command Claude runs.

Two things are per review, and off unless you ask for them when you ask for the review: posting your notes to the PR as a GitHub review from the page ("with posting to GitHub on"), and a plain HTTP link a phone on the same network can open ("with a link for my phone").

## The dashboard

A small local server in `dashboard/` serves the page and passes messages between it and the session that started it. Notes and chat take markdown and pasted or dropped screenshots, and the page shows you when the session is stuck at a permission prompt, and you can allow or deny it there from this machine or your phone, though not through the share link. You can also ask Claude for a code review from the page, then fix or dismiss each finding there; findings are checked again after a rebuild, and so are threads left open on the change. A fix says where the change is and what was run to check it, and each thread shows whose turn it is. You can also have Claude quiz you on the riskiest parts of the change, to check you've understood it before anyone else reads it. Claude can carry out the guide's things to try by hand too, and what happened shows under each step, with a screenshot where one helps. Where your checkout differs from what was pushed, you can preview your local code in place and revert a change. You can post a message to a thread for everyone on the review without sending it to Claude. `@` mentions the owner or a guest, who gets a card and a Mentions group in their notes. Typing `:` and a couple of letters picks an emoji, and `/` lists the skills Claude can run, so you can ask for `/code-review` without knowing the exact name. If messages sit unheard for 30 seconds, the server nudges the session to listen again. Threads and reviewed ticks are kept in a SQLite file between builds and across restarts. `dashboard/README.md` has the details.

## Sharing

You can open a running review to teammates over a link, so they can read the guide, chat and see Claude's answers. Their page shows which sections you've reviewed, folds the routine ones you've read, and lists where a second look matters. Press Share in the page's header, or ask Claude. The dashboard starts a Cloudflare quick tunnel and shows a link to send them.

- Install [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/). It's free, and quick tunnels need no Cloudflare account. Its email one-time PIN (the allowed emails setting) doesn't work with the dashboard yet; see Configuration.
- A `~/.cloudflared/config.yml` can stop quick tunnels working. If Share fails, move it aside and try again.
- With no setup, teammates type their name to ask to come in. Nothing checks the name is theirs, or that they can see the repo, so your approval is the only gate.
- For a checked identity, have them sign in with GitHub instead, using a code they enter at github.com/login/device. That needs a GitHub OAuth app of your own: [register one](https://github.com/settings/applications/new) with Enable Device Flow ticked (any homepage and callback URL will do, since neither is used, and there is no secret), then put its client id in the plugin's settings (see Configuration). The plugin doesn't ship one, so that GitHub's limit of 50 sign-in codes an hour per app is yours alone and guests see your app's name when they sign in. Guests must then be collaborators on the repo, and your `gh` needs push access to it to check that.
- Either way, each guest then waits for you to let them in from the Share popover. It shows where and in what browser they signed in, and a 4-digit code their page shows too, so you can check it with them before letting them in.
- The link changes each time sharing starts, and stops working when you stop sharing.

Guests see every thread on the review, including ones from before you shared. Claude answers their questions and reads the repo for them, but asks you before it does anything else for a guest. The details are in `dashboard/README.md`.

## Stacks

Ask for a review of any PR in a stack and you get one page for every layer. It says what each layer does in the stack, and what only shows across it, such as code a later layer rewrites. The layers come from the open PRs' base branches, so stacks made with [gh-stack](https://github.com/github/gh-stack), [Graphite](https://graphite.dev) or by hand all work, with no checkout. That's why it needs `gh`, and why each layer has to be an open PR in the same repo. Where two open PRs build on the same one, it stops there, so ask from the top PR of the branch you want.

## Requirements

- A local clone of the repo and `git`.
- [`gh`](https://cli.github.com) logged in, for a PR by number, its CI and the annotations CI left on lines, its linked GitHub issues, and stacks. Without it, the guide works for any branch on any host, compared against `--base` or the remote's default branch.
- Python 3.9 or later, standard library only.
- [Bun](https://bun.sh) 1.4 or later, for the dashboard.
- `LINEAR_API_KEY` if you want Linear issues shown (see Configuration).
- Without Bun, the skill renders a static page and publishes it with the Artifact tool and its `comments` capability, and notes go back as one comment. Without that either, Claude opens the page from disk and Copy notes takes them back.

`skills/pr-review-dashboard/SKILL.md` has how it runs and how notes come back; `reference/page.md`, `reference/collect.md` and `reference/design-notes.md` beside it have what the page shows, what counts as noise, what gets flagged, and why the models and steps are what they are. `dashboard/SESSION.md` is what the session does with the dashboard.
