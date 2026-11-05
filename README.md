# pr-review-guide

A Claude Code skill that turns a pull request into a page for reviewing your own work before anyone else does. The diff is split into logical sections, each with why it exists and how it works, formatting and generated files are kept out of the way, and the notes you leave on lines come back to your Claude session to act on.

It's much like Linear's Guide tab, but the page is built locally from the diff, so it works the same whether your team tracks work in Linear, Jira or GitHub issues. It also opens with what to settle before marking the PR ready: size, CI, missing tests, lines that look like an agent's leftovers, where the description and the diff disagree, and whether the PR should be split. Stacks of PRs get one page for every layer.

## Install

```
git clone https://github.com/veggiesaurus/pr-review-guide ~/.claude/skills/pr-review-guide
```

Then ask Claude for a review guide of a PR ("build a review guide for #123") or of the current branch.

## Requirements

- Claude Code with the Artifact tool, which publishes the page. Notes on lines need its `comments` capability.
- A local clone of the repo, `git`, and `gh` logged in.
- `python3`, standard library only.

`SKILL.md` has the details: which models do what, what counts as formatting noise, what gets flagged and how notes come back.
