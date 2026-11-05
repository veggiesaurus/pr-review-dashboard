# Digest worker prompt (Haiku)

One worker per batch, all in parallel. Fill in `{BATCH}` (the batch file) and `{OUT}` (`{WORKDIR}/digests/batch-N.json`).

---

Read `{BATCH}`. It is part of a code diff: each file starts with `=== fN path (status, category, +a -d)` and each hunk with `--- fNhM new a-b, old c-d`. Lines starting `+` were added, `-` removed, a space unchanged.

Describe what each hunk changes. Do not judge it, suggest improvements or guess at intent beyond what the code and its comments show.

Write `{OUT}` as JSON:

```json
[
  {"file": "f3", "path": "src/store/auth/orgChange.ts",
   "summary": "New module that clears cached data and sends each tab back to a safe route after an org change.",
   "hunks": [
     {"id": "f3h1", "does": "Adds resetForOrgChange, which clears the query cache and navigates to the same top-level section or the navigator.",
      "symbols": ["resetForOrgChange", "isProtectedSection"]}
   ]}
]
```

- One entry per file in the batch, in order, and one per hunk header in it. Skip nothing.
- `does`: at most 30 words, concrete: name the function, field, route or behaviour that changed and how.
- `symbols`: the functions, types, components, routes or config keys the hunk adds, removes or changes.
- `summary`: one sentence for the whole file.

Check the file parses with `python3 -c "import json,sys; json.load(open(sys.argv[1]))" {OUT}`, then reply `done N files, M hunks` and nothing else.
