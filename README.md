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

## The dashboard

A small local server in `dashboard/` serves the page and passes messages between it and the session that started it. Notes and chat take markdown and pasted or dropped screenshots, and the page tells you when the session is stuck at a permission prompt in the terminal. You can also ask Claude for a code review from the page, then fix or dismiss each finding there; findings are checked again after a rebuild. Where your checkout differs from what was pushed, you can preview your local code in place and revert a change. Threads and reviewed ticks are kept in a SQLite file between builds and across restarts. `dashboard/README.md` has the details.

## Stacks

Ask for a review of any PR in a stack and you get one page for every layer. It says what each layer does in the stack, and what only shows across it, such as code a later layer rewrites. The layers come from the open PRs' base branches, so stacks made with [gh-stack](https://github.com/github/gh-stack), [Graphite](https://graphite.dev) or by hand all work, with no checkout. That's why it needs `gh`, and why each layer has to be an open PR in the same repo. Where two open PRs build on the same one, it stops there, so ask from the top PR of the branch you want.

## Requirements

- A local clone of the repo and `git`.
- [`gh`](https://cli.github.com) logged in, for a PR by number, its CI and the annotations CI left on lines, its linked GitHub issues, and stacks. Without it, the guide works for any branch on any host, compared against `--base` or the remote's default branch.
- Python 3.9 or later, standard library only.
- [Bun](https://bun.sh) 1.4 or later, for the dashboard.
- `LINEAR_API_KEY` in the environment if you want Linear issues shown; read-only is enough.
- Without Bun, the skill renders a static page and publishes it with the Artifact tool and its `comments` capability, and notes go back as one comment. Without that either, Claude opens the page from disk and Copy notes takes them back.

`skills/pr-review-dashboard/SKILL.md` has how it runs and how notes come back; `reference/page.md`, `reference/collect.md` and `reference/design-notes.md` beside it have what the page shows, what counts as noise, what gets flagged, and why the models and steps are what they are. `dashboard/SESSION.md` is what the session does with the dashboard.
