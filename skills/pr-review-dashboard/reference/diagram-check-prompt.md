# Diagram checker prompt (Opus, medium effort)

A fresh Agent, never the diagram worker, so it reads the diagrams cold. Spawn it as soon as the diagram worker has written `diagrams.json` with any diagrams in it; skip it for `{"diagrams": []}`. Fill in `{WORKDIR}`, `{CLONE}` (the clone's path) and `{HEAD}` (the head sha from `hunks.json`).

---

Someone else has drawn diagrams of a code change for its review page: pictures of where the change fits into the system around it. You did not draw them. Your job is to find where they are wrong. The author looks at these before reading the code and takes them on trust, so an arrow that never happens, a reply the code doesn't send or a part marked as changed that isn't costs far more than a clumsy label.

Read `{WORKDIR}/diagrams.json`, then `{WORKDIR}/review.diff` in full, then the section titles in `{WORKDIR}/guide.json`, then the `CLAUDE.md` and `AGENTS.md` files in the clone and the folders above it, and its README, for what the system is made of and what its team calls each part. If `{WORKDIR}/diagram-rules.md` exists, read it in full: the rules this project adds to the general ones, which win where they disagree. A diagram that breaks one of them is an issue, the same as one that breaks a rule below. A diagram also shows code the change doesn't touch: the callers, services and states around it. Check those against the clone at the head commit, with `git -C {CLONE} show {HEAD}:path/to/file` for a file and `git -C {CLONE} grep -n NAME {HEAD}` for where a name is used. Never check out, edit or run anything in the clone.

If `{WORKDIR}/../stack.json` exists, this change is one layer of a stack of pull requests, with the other layers' folders beside this one. A pull request can also sit on another one without a `stack.json`: when `meta.base` in `{WORKDIR}/hunks.json` isn't the repo's default branch, its neighbours are `gh pr list -R <meta.repo> --head <meta.base>` and `gh pr list -R <meta.repo> --base <meta.head>`, and `gh pr diff N -R <meta.repo>` shows their code. The diagram may show parts that a later layer brings, such as the endpoint that will call this layer's code, when they are left unmarked and `why` names the PR that brings them; that is not an issue. Check them against that layer's `review.diff`, and mark only this layer's parts as added, changed or removed.

In `review.diff` each file starts with `=== fN path` and each hunk with `--- fNhM`; `[phrase](f4h2)` in `why` links a phrase to a hunk or file.

Check every diagram, element by element:

1. Level. A diagram shows the running system, not the code. In a sequence diagram each participant is something that runs or holds state (a service or worker, a device or person, a database, cache, queue or bucket, an outside system), named as it is deployed (check its deploy config, such as a helm chart, rather than its package or folder name); a function, class, method, module or file as a participant is an issue, and so is a service under a descriptive or package name ("Billing API server", `billing_worker2`), and so is a job, consumer or feature inside a service drawn as its own participant, a store with a qualifier on its name ("Main Postgres", "Redis (cart cache)") where the key or table belongs in the message, or several stores merged into one participant, and so is a step that is one function calling another inside the same service. A flowchart's nodes are services, stores, queues and outside systems: a package, function, module or feature flag as a node is an issue, since a flag or condition belongs on the edge it decides. A caller that appears nowhere in the code, this PR's neighbours or the clones beside `{CLONE}` is an invented one, and an issue. The fix names the participant each one belongs to, and says which steps fold into that participant or drop out.
2. Parts. Each participant, node, state, class or table is in the system at head, under its name or one its team would recognise, and does what its label says. A caller or consumer in another repo can be checked in the clones beside `{CLONE}`.
3. Steps. Each message, arrow or transition happens in the code, between those parts, in that direction and in that order. Each reply says what the code returns: the values, the status codes, the error.
4. Branches. Each `alt`, `else`, `opt`, `loop` or decision matches a condition or loop in the code, and its label states that condition. None is shown that the code doesn't have. Read the code's tests too: the cases they assert are often the plainest list of outcomes. Every outcome the change adds or alters must be there; outcomes it leaves as they were may be folded into one `other failures` branch or left out, and that is not an issue.
5. Marks. A part marked `added` is new in this diff, `changed` is altered by it and `removed` is taken out by it. Nothing the diagram is about that the diff changes is left unmarked. A diagram with `"allNew": true` has no marks, and every step it draws must be new in this diff.
6. `why`. Its sentence is true of the code, and each link points at the hunk or file that does what its phrase says.
7. `sections`. It lists the guide sections, numbered from 1, that the diagram covers.

A simplification is fine when it is true; it is wrong when a reader would come away believing something the code doesn't do. Two unconnected flows in one diagram, with no step joining them, is an issue: the fix splits it in two or draws the read that joins them. Apart from the level and a note longer than one short line (about 60 characters without a `<br/>`, which runs out of its box), don't report style, layout, label wording that is already true, or what you would have drawn instead, and don't propose new diagrams. When something can't be confirmed from the code, list it as unconfirmed rather than guess. Diagrams with nothing wrong are a good result; say so with empty lists.

Write `{WORKDIR}/diagram-verify.json`:

```json
{"issues": [
  {"diagram": 1, "where": "the branch after POST /events",
   "problem": "Shows every failure as a 503, but the forward answers 400 when the engine rejects the upload with a 400 or 413 (f4h1, and its status test).",
   "fix": "Split the branch: the engine accepts, the engine rejects the upload (400), any other failure (503)."}
 ],
 "unconfirmed": [
  {"diagram": 1, "where": "Legacy pipeline: analyse_images", "why": "No call to analyse_images on this path at the head commit; the handler calls run_pipeline."}
 ]}
```

Every `fix` is concrete enough to apply without reading your reasoning: the lines to change and what they become.

Reply with the number of issues, one line per issue as `diagram N, where: problem`, then the number unconfirmed, and nothing else.
