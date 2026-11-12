# pr-review-dashboard

A Claude Code plugin that turns a pull request into a dashboard for reviewing your own work before anyone else does. The diff is split into logical sections, each with why it exists and how it works, and formatting and generated files are kept out of the way. The dashboard runs on your machine beside your Claude session: notes and questions you leave on lines reach the session as you send them, its answers show in the thread, and the PR's checks and Linear issues stay live.

It's much like Linear's [Guide](https://linear.app/docs/diffs#guides) tab, but it's built locally from the diff, so it works the same whether your team tracks work in Linear, Jira or GitHub issues. It also opens with what to settle before marking the PR ready: size, CI, missing tests, lines that look like an agent's leftovers, the description and linked issue checked claim by claim against the diff, a few things to try by hand, and whether the PR should be split. Stacks of PRs get one page for every layer.

Once Claude has worked through your notes, rebuild it and the dashboard shows what's new since the last build, keeping your threads and your ticks on the files that didn't change. Code that only moved shows as a move, CI's lint and type errors sit under their lines, and you can read the diff side by side or one commit at a time.

## Install

```
/plugin install pr-review-dashboard --marketplace veggiesaurus/pr-review-dashboard
```

On a Claude Code older than 2.1.275, add the marketplace first with `/plugin marketplace add veggiesaurus/pr-review-dashboard`, then `/plugin install pr-review-dashboard@pr-review-dashboard`. To use it without the plugin system, copy `skills/pr-review-dashboard` into `~/.claude/skills/`; the dashboard needs the whole plugin.

Then ask Claude for a review of a PR ("build a review dashboard for #123") or of the current branch. The first run installs the dashboard's packages and builds it.

## The dashboard

A small local server in `dashboard/` serves the page and passes messages between it and the session that started it. Besides notes and chat, you can ask Claude for a code review from the page, then fix or dismiss each finding there; findings are checked again after a rebuild. Where your checkout differs from what was pushed, you can preview your local code in place and revert a change. Threads and reviewed ticks are kept in a SQLite file between builds and across restarts. `dashboard/README.md` has the details.

Without [Bun](https://bun.sh), the skill falls back to a static page published as an artifact, where notes go back as one comment.

## Stacks

Ask for a guide of any PR in a stack and you get one page for every layer. It says what each layer does in the stack, and what only shows across it, such as code a later layer rewrites. The layers come from the open PRs' base branches, so stacks made with [gh-stack](https://github.com/github/gh-stack), [Graphite](https://graphite.dev) or by hand all work, with no checkout. That's also why it needs `gh`: it lists the open PRs to find the layers, so each one has to be an open PR in the same repo. Where two open PRs build on the same one, it stops there, so ask from the top PR of the branch you want.

## Requirements

- A local clone of the repo and `git`.
- [`gh`](https://cli.github.com) logged in, to build a guide for a PR by number, show its CI and the annotations it left on lines, and fetch its linked GitHub issues, and for any stack of PRs (below). Without it, the guide works for any branch on any host, compared against `--base` or the remote's default branch.
- Python 3.9 or later, standard library only.
- [Bun](https://bun.sh) 1.4 or later, for the dashboard. `LINEAR_API_KEY` in the environment, read-only is enough, if you want Linear issues shown.
- Without Bun: the Artifact tool and its `comments` capability, to publish the static page and send notes back. Without that either, Claude opens the page from disk and Copy notes takes them back.

`skills/pr-review-dashboard/SKILL.md` has how it runs and how notes come back; `reference/page.md`, `reference/collect.md` and `reference/design-notes.md` beside it have what the page shows, what counts as noise, what gets flagged, and why the models and steps are what they are. `dashboard/SESSION.md` is what the session does with the dashboard.
