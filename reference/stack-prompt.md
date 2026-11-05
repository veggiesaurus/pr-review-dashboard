# Stack check prompt (Opus, default effort)

One Agent, once every layer of the stack has been through steps 3 to 6. Fill in `{STACK}` and `{SCRIPTS}`.

---

A stack of pull requests is being reviewed as a whole: each layer is a PR built on the one below it, and each already has a guide, written and checked against its own diff. Those guides could only see their own layer. Your job is the part they could not see: what each layer is for in the stack, and where one layer's code is explained by another's.

Read, in this order:

1. `{STACK}/stack.json`: `layers` bottom to top (`dir` is the layer's folder), then `links` (a name defined in one layer's hunk, `from`, and used on added lines of later layers' hunks, `usedIn`; a ref is `PR:hunk`, like `1014:f5h1`), `churn` (lines a layer adds that a later layer removes again from the same file) and each layer's `needsRebase`.
2. For each layer, bottom first: `{STACK}/<dir>/description.md` (its PR description and commits), `guide.json` (its sections; `items` name the layer's hunks and files) and `description.json` (claims in the description its own diff does not bear out, and changes the description leaves out).
3. Only where you need the code, search `{STACK}/<dir>/review.diff` for a hunk id (`--- f5h1`). Do not read every diff in full, and do not search the repository.

Then do four things.

**Describe each layer.** One or two sentences, at most 40 words: what the layer does, and what it sets up for the layers above it or takes from the ones below. Plain text with no links, since it is shown in the stack's list. Not a summary of its sections; the reader sees those when they open the layer.

**Point across layers where it explains a section.** A lower layer often adds something only a later layer uses, so on its own it reads as dead code; a higher layer often only makes sense given what a lower one set up. Where a reviewer reading one layer would wonder what something is for, or where it comes from, add a short clause to that section's `why` or `how` in its `guide.json`, linking into the other layer: `[the sign-in page renders it](1013:f42h1)`. The page already lists every link under its hunk, so add a clause only where it changes how the section reads, at most one per section, and keep `why` and `how` to one or two sentences each. Correct any sentence another layer contradicts, such as one saying nothing uses something yet. Change nothing else in a guide: not titles, items, risk notes or the split.

**Annotate the description findings.** Where another layer explains a finding in a layer's `description.json`, such as a claim about code that lands in a different layer, add a `"stack"` field to that finding with a short note: "Lands in #1014; the sentence belongs in that PR's description." Do not delete findings.

**List what only shows across the stack**, as `issues`:

- `churn`: a layer adds code that a later layer rewrites or removes, so the reviewer reads it twice. Start from the `churn` groups, and report one only when it is a real rewrite, not a line growing as the stack grows.
- `placement`: a hunk that belongs in another layer because it serves that layer's purpose and not its own. Adding something a later layer uses is normal in a stack; report it only when it does not fit its own layer's purpose.
- `order`: a layer that cannot merge on its own because it needs something only a later layer adds.
- `description`: a layer's description that describes another layer's work, when that is not already a finding you annotated.
- `other`: anything else a reviewer of the whole stack needs, such as a layer that needs a rebase onto the one below.

Each issue is `{"kind", "layers": [1013, 1014], "problem", "fix"}`, with `problem` and `fix` one sentence each and links written `[phrase](1014:f5h1)`. Do not repeat what a layer's own guide or description check already says. An empty list is a good result.

Write `{STACK}/stack-guide.json`:

```json
{"layers": [{"number": 1021, "summary": "Adds the sign-in card, the one-time-code step and their layout, which nothing renders until the login page in #1013 uses them."}],
 "issues": [{"kind": "churn", "layers": [1013, 1014],
             "problem": "#1013 adds [a retry delay](1013:f24h1) that #1014 replaces with [the refresh scheduler](1014:f20h1).",
             "fix": "Add the scheduler in #1013, or leave the delay out of it."}],
 "edits": [{"where": "#1021 section 3 how", "what": "added that the login page in #1013 renders the card"}]}
```

`layers` has an entry for every layer. `edits` lists every change you made to a `guide.json` or `description.json`, so they can be checked; it is not shown on the page.

Plain, specific language throughout. No em-dashes, no "seamless", "robust", "comprehensive", "leverage".

Then run `python3 {SCRIPTS}/render.py {STACK} --check`. It checks every layer's guide, every link into another layer and the summaries. Fix every problem it reports and run it again until it passes; its warnings are heuristics, so fix the ones that are right.

Reply with one line per layer summary, one per issue and one per edit, and nothing else.
