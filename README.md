# pr-review-dashboard

A Claude Code skill that turns a pull request into a page for reviewing your own work before anyone else does. The diff is split into logical sections, each with why it exists and how it works, formatting and generated files are kept out of the way, and the notes you leave on lines come back to your Claude session to act on.

It's much like Linear's [Guide](https://linear.app/docs/diffs#guides) tab, but the page is built locally from the diff, so it works the same whether your team tracks work in Linear, Jira or GitHub issues. It also opens with what to settle before marking the PR ready: size, CI, missing tests, lines that look like an agent's leftovers, the description and linked issue checked claim by claim against the diff, a few things to try by hand, and whether the PR should be split. Stacks of PRs get one page for every layer.

Once Claude has worked through your notes, rebuild it and the page shows what's new since the last build, keeping your ticks on the files that didn't change. Code that only moved shows as a move, CI's lint and type errors sit under their lines, and you can read the diff side by side or one commit at a time.

## Install

```
/plugin install pr-review-dashboard --marketplace veggiesaurus/pr-review-dashboard
```

On a Claude Code older than 2.1.275, add the marketplace first with `/plugin marketplace add veggiesaurus/pr-review-dashboard`, then `/plugin install pr-review-dashboard@pr-review-dashboard`. To use it without the plugin system, copy `skills/pr-review-dashboard` into `~/.claude/skills/`; the dashboard needs the whole plugin.

Then ask Claude for a review guide of a PR ("build a review guide for #123") or of the current branch.

## Dashboard

With [Bun](https://bun.sh) installed, the page is served by a small local server in `dashboard/` instead of being published. Notes and chat reach your Claude session as you send them and its answers show in the thread, review findings can be fixed or dismissed from the page, and the PR's checks and Linear issues stay live. Threads and reviewed ticks are kept between builds. `dashboard/README.md` has the details. Without Bun, the skill publishes the page as a static artifact.

## Stacks

Ask for a guide of any PR in a stack and you get one page for every layer. It says what each layer does in the stack, and what only shows across it, such as code a later layer rewrites. The layers come from the open PRs' base branches, so stacks made with [gh-stack](https://github.com/github/gh-stack), [Graphite](https://graphite.dev) or by hand all work, with no checkout. That's also why it needs `gh`: it lists the open PRs to find the layers, so each one has to be an open PR in the same repo. Where two open PRs build on the same one, it stops there, so ask from the top PR of the branch you want.

## Requirements

- A local clone of the repo and `git`.
- [`gh`](https://cli.github.com) logged in, to build a guide for a PR by number, show its CI and the annotations it left on lines, and fetch its linked GitHub issues, and for any stack of PRs (below). Without it, the guide works for any branch on any host, compared against `--base` or the remote's default branch.
- The Artifact tool in Claude Code to publish the page, and its `comments` capability to send notes back to the session. Without it, Claude opens the page from disk instead: notes work the same, and Copy notes takes them back to the session.
- Python 3.9 or later, standard library only.
- [Bun](https://bun.sh) 1.4 or later for the dashboard. It is optional.

`SKILL.md` has the details: which models do what, what counts as formatting noise, what gets flagged and how notes come back.
