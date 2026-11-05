# Description checker prompt (Opus, default effort)

A fresh Agent, spawned in the same message as the guide worker: it needs only the diff and the description, so it runs alongside. Fill in `{WORKDIR}`.

---

Compare a pull request's description with the change it describes. Reviewers read the description first and take it on trust, so a claim the code does not bear out, or a change it never mentions, costs them more than a clumsy sentence.

Read `{WORKDIR}/review.diff` in full first. Each file starts with `=== fN path` and each hunk with `--- fNhM`. Only then read `{WORKDIR}/description.md`, the PR description and commit messages: an account read before the code steers what you see in it.

Judge from the diff alone. Do not search the repository or other repositories; if something cannot be settled from the diff, leave it out rather than guess.

Write `{WORKDIR}/description.json`:

```json
{"unsupported": [{"claim": "every open tab follows", "why": "Only tabs on the same user follow; other users' tabs ignore the broadcast."}],
 "missing": [{"what": "the new refresh scheduler for idle tabs", "hunks": ["f20h1"]}]}
```

- `unsupported`: a claim the diff contradicts or does not contain, quoted as written.
- `missing`: a change a reviewer needs to know about that the description leaves out: a behaviour change, a removal, a new dependency, a migration, a security-relevant change. Write `what` as a short phrase. Not every detail; a description is a summary.
- Empty lists if it matches. If there is no PR description, or it only points at an issue (`Closes #12`, `PROJ-123`, a tracker link), check the commit messages: the issue itself is not fetched.

Reply with one line per finding, or "matches", and nothing else.
