# Checker prompt (Opus, medium effort)

A fresh Agent, never the guide worker, so it reads the guide cold. Fill in `{WORKDIR}`, `{SCRIPTS}`, `{REPO}` (the local clone) and `{HEAD}` (the head sha from `hunks.json`).

---

Someone else has split a code change into sections for review and explained each one. You did not write it. Your job is to find where it is wrong, not to rewrite it in your own words: the author of the code will review section by section on the strength of this guide, so a hunk in the wrong section or a sentence that is not true of the code costs them more than a clumsy phrase.

Read `{WORKDIR}/review.diff` in full, then `{WORKDIR}/guide.json`, then run `python3 {SCRIPTS}/render.py {WORKDIR} --check` for its warnings. The PR description is checked separately; you do not need it.

Judge the guide against the diff. Where a hunk needs more context, read that changed file at the head commit with `git -C {REPO} show {HEAD}:<path>`, but do not search the rest of the repository or other repositories. If a sentence cannot be confirmed from the diff and the changed files, report it as unconfirmed rather than go looking: the guide describes this change, not the system around it.

In `review.diff` each file starts with `=== fN path`, each hunk with `--- fNhM`, and a hunk's `uses:` and `used by:` lines say which other hunks it shares names with. Those come from matching names, so they are hints, not proof. In `guide.json` an item `f7` means every hunk of that file that no other item names, and `[phrase](f4h2)` links a phrase to a hunk or file.

Check, in this order:

1. Placement. For every hunk, does it serve the purpose its section states? If another section's purpose fits it better, say which. Pay most attention to files split across sections and to hunks whose `uses`/`used by` point into another section.
2. Claims. For every sentence in `why` and `how`, is it true of the code? Look for overstatement, behaviour the code does not have, the wrong mechanism, or a section that leaves out the main thing its hunks do.
3. Links. Does each linked phrase point at the hunk that does what the phrase says?
4. Order. Does any section rely on something only explained in a later one?
5. Shape. Is any section really two things, or are two sections really one?
6. Risk. Does a section that touches auth, tokens, money, migrations, data deletion, dependencies, outside input, concurrency or deploy config lack a `risk` note, or does a note claim a risk the code does not carry?
7. Split. If `split` is present, could each suggested PR merge on its own, in that order? If it is absent and the `review.diff` header says the change is long or too big for one review, is there a clean split the guide missed?
8. Warnings. For each warning from `--check`, decide whether it is a real problem here or fine.

Do not report style preferences, synonyms, or rewordings of sentences that are already true. Leaving something out is an issue only when the section's main point is missing or the text would mislead: a section is one or two sentences, not an inventory, and a fix that adds a clause for every detail makes the guide worse. A guide with nothing wrong is a good result; say so with an empty list.

Write `{WORKDIR}/verify.json`:

```json
{"issues": [
  {"kind": "move", "where": "f18h3 in section 2",
   "problem": "Adopting a shared token is what carries a switch to other tabs, which is section 4's purpose.",
   "fix": "Move f18h3 to section 4."},
  {"kind": "claim", "where": "section 3 how",
   "problem": "Says the layout remounts on the org id; it remounts on the session owner, user and entry org together.",
   "fix": "The protected layout remounts when the session owner changes and renders no page until the reset's navigation lands."}
 ],
 "warnings": [
  {"warning": "section 4 is one 3-line hunk", "verdict": "fine", "why": "The idle refresh is its own behaviour."}
 ]}
```

`kind` is one of `move`, `claim`, `link`, `order`, `split`, `merge`, `risk`; for a suggested split of the PR use `split` too, with the PR grouping as the `fix`. Every `fix` is concrete enough to apply without reading your reasoning: the hunk and the target section, or the replacement sentence.

Reply with the number of issues and one line per issue, and nothing else.
