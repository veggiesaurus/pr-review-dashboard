# What the Claude Code session does with the server

The session starts the server, gives the user the link, listens for what the page sends, and answers through the API. Everything below uses the token from the state file; never print it.

## Starting it

```
bun run server/index.ts --state STATE.json --data DIR --repo CLONE [--github-comments]
```

`--data` is the folder `collect.py` or `stack.py` wrote. Run it in the background. When it is up it writes `STATE.json` (mode 0600):

```json
{ "port": 54524, "token": "…", "origin": "http://127.0.0.1:54524", "link": "http://127.0.0.1:54524/?t=…", "pid": 4242 }
```

Give the user `link`, whole: the code in it is what lets the page call the API, and the page keeps it for later tabs on the same address. Keep the state file in a folder only the user can read, not straight in `/tmp`. Read `token` into a shell variable without echoing it:

```
T=$(python3 -c "import json;print(json.load(open('STATE.json'))['token'])")
O=$(python3 -c "import json;print(json.load(open('STATE.json'))['origin'])")
```

Notes, chat and reviewed ticks are kept in `prg.db`, a SQLite file in the state file's folder. Each thread is kept with the PR it is about and, in a stack, GitHub's number for the stack, so a restart brings back the threads of the review's PRs and its stack, including anything still waiting for a session, whatever `--state` and `--data` it is given. Message ids are numbered across every review. Start every review with its state file in the same folder so they share the one database.

`--host ADDRESS` also listens on that address of this machine and adds `lanLink` to the state file, for a phone on the same network. Only start it that way when the user asks, and say that the link is plain HTTP on their network.

`--github-comments` lets the user post their notes to the pull request as a review from the page. It is off by default. The session never posts; the page shows the user exactly what would go, under whose login, and posts only when they confirm.

## Listening

Arm Monitor's `ws` source on `ws://127.0.0.1:<port>/api/session/ws?t=<token>`. Each text frame is one notification. Monitor expires after 30 minutes at most, so re-arm it when it does. While nothing listens, frames wait on the server and go when a session connects. A client that can't hold a socket can long-poll `GET /api/session/wait` with the bearer token instead.

## The frames

Every frame starts `[review page]`, names the review, and says what the thread is about: the location in the skill's form (`path:R<n>@<sha>` for a line of the head, `path:L<n>@<sha>` for a removed line, with `#<pr> ` in front on a stack), then the code or text it is about, indented. The user's words come last, indented by two spaces.

A chat, sent as soon as the user asks:

```
[review page] chat m2 on repo feature at 63268a7
about guide section 1, "Serve under a new prefix"
    covers src/posts.ts:R1-R5@63268a7 (f3h1), tests/posts.test.ts:R1-R10@63268a7 (f6h1)
  Why a new prefix rather than a redirect?
(answer with POST /api/replies {"replyTo":"m2","text":"…"})
```

A follow-up names the thread it belongs to, and says when it reopens one the session had settled:

```
[review page] chat m20 on repo feature at 63268a7, following up on m8 (reopened)
about the file src/slug.ts@63268a7 (added, +6 -0)
    hunks at R1-R6 (f4h1)
  Use a 308 so it keeps the method.
(answer with POST /api/replies {"replyTo":"m20","text":"…"})
```

A batch of notes, sent when the user presses Send, in page order (bottom layer first, down each file). A batch longer than about 6,000 characters comes as several frames, the first saying how many and the rest headed `[review page] batch 1, part 2 of 3`.

```
[review page] batch 1: 2 notes on o/r #11, #12, a stack. Fix what they ask in the working tree and leave it unstaged; answer questions in the reply. For each note, POST /api/replies {"replyTo":"<id>","state":"working"} when you start it, then {"replyTo":"<id>","state":"done"|"answered"|"declined","text":"what you did, the answer, or why not"}.

m3 about #11 src/slug.ts:R2@63268a7 | return text
    2 +   return text
  Bottom layer: slug helper needs a test.

m2 about #12 src/posts.ts:R4@63268a7 | return `/blog/${slugify(title)}`;
    4 +   return `/blog/${slugify(title)}`;
  Top layer: why /blog here?
```

What a thread can be about, and what the frame quotes:

| About                 | Location and quote                                                       |
| --------------------- | ------------------------------------------------------------------------ |
| a line or a range     | `src/a.ts:R12-R14@sha`, the numbered lines                               |
| a hunk                | `the hunk src/a.ts:R10-R20@sha (f3h1)`, its changed lines                |
| a file                | `the file src/a.ts@sha (modified, +3 -1)`, its hunks                     |
| a guide section       | its number and title, the hunks it covers                                |
| a flagged line        | `src/a.ts:R8@sha, flagged as debug output left in`, the line             |
| a CI annotation       | `src/a.ts:R4@sha, CI warning from lint`, the message and its link        |
| a CI check            | `the CI check "lint"`, by name only, since checks are live               |
| a description finding | which list it is in and its text, with the reason and the hunks          |
| a stack issue         | its kind and layers, the problem, the fix, and where each linked hunk is |
| the review as a whole | `the review as a whole`                                                  |

The page sends ids, and the server finds the paths, code and text in the review itself, so what a frame quotes is what the review says. A thread whose line went away in a rebuild says `(gone from the diff since a rebuild; this is where it was)` and keeps the old location; find it by content.

The CI poller can also send a frame when the user has asked to hear about checks; it is plain text and needs no answer.

## Answering

```
curl -s -X POST -H "Authorization: Bearer $T" -H "content-type: application/json" "$O/api/replies" -d '{"replyTo":"m3","state":"working"}'
curl -s -X POST -H "Authorization: Bearer $T" -H "content-type: application/json" "$O/api/replies" \
  -d '{"replyTo":"m3","state":"done","text":"Added a test for `slugify` in tests/slug.test.ts."}'
```

`text` adds Claude's message to the thread on the page; `[phrase](f3h1)`, `[phrase](11:f3h1)` and `` `code` `` in it become links and code there. `state` says what the session did with a note:

- `working`: started on it
- `done`: changed the code as asked
- `answered`: it was a question, and `text` is the answer
- `declined`: not doing it; `text` must say why

The page's diff is the pull request as pushed, so a fix you leave in the working tree isn't in it. The page finds it by itself: within a few seconds the first line you changed gets a preview button in the Guide and Diff tabs, which shows the checkout's code there in place of what was reviewed. There is nothing to send for that, but say in your reply which file and roughly where, so the user knows where to look.

`done`, `answered` and `declined` settle a thread, and the page folds it away with the last answer showing. Text without a state leaves the state as it was. A state needs `replyTo`. The older `{"resolved": true}` still works and means `done`. Text gets 201 with the new message; a state alone gets 200 with the thread. An unknown id gets 404.

Report in the session as the skill says, one line per note, as well as on the page.

## A review asked for from the page

The user can ask for a review of one PR, at medium effort from the button or at any effort from low to xhigh in the menu joined to it. The request is a chat thread, and its frame says what to run:

```
[review page] review 3 requested on o/r #11, #12, a stack, as chat m31
about #12 as a whole
Run the code-review skill at medium effort on https://github.com/o/r/pull/12, whose clone is /path/to/clone: /code-review medium https://github.com/o/r/pull/12
Don't pass --comment or --fix: nothing goes to GitHub, and the user picks what to fix on the page.
Then POST /api/reviews/3/findings {"findings":[{"file":"path from the repo's root","line":12,"summary":"…","failure_scenario":"…","severity":"high","recommended":true}]}
with every finding, most severe first, "severity" high, medium or low, and "recommended" true on the ones worth acting on (an empty list when there are none),
and POST /api/replies {"replyTo":"m31","state":"answered","text":"which findings to act on and why"}.
```

Run the skill from the clone, so it can read the code around the diff. Its findings come back as `file`, `line`, `summary` and `failure_scenario`, most severe first; pass them on as they are and add `severity` and `recommended`. The skill ranks its findings but gives no severity, so judge each from its failure scenario: `high` for wrong behaviour users will meet, `medium` for a real bug on a narrower path, `low` for a cleanup or a nit. Each becomes a thread Claude starts: on its line when the diff can show it, else on its file, else on the PR. The reply to the request is the recommendation the page shows above the findings. Say what you're doing with `POST /api/activity` and `replyTo` the request while the review runs, since it can take minutes.

When the user presses Fix this on a finding, a chat frame follows up on that finding's thread and quotes it as `the finding: …`. Fix it in the working tree, leave it unstaged, and answer with `{"replyTo":"<id>","state":"done","text":"what you changed"}`, or `declined` with the reason.

After a rebuild, findings still open whose file changed go back to you in one frame:

```
[review page] re-check 2 review findings on o/r #11, #12, a stack: the code they are about changed in a rebuild. For each, POST /api/replies {"replyTo":"<id>","state":"done","text":"how it was fixed"} when it no longer holds, or {"replyTo":"<id>","text":"why it still holds"} when it does.

m33 about #12 src/posts.ts:R4@63268a7 | return `/blog/${slugify(title)}`;
    4 +   return `/blog/${slugify(title)}`;
  The /blog prefix is hard-coded.
```

Read the code as it is now before answering; a finding is only asked about once for each change to its file.

## Asking the user something

When you need a choice before going on, put it on a reply as `ask`, up to four questions, each with two to six options:

```
curl -s -X POST -H "Authorization: Bearer $T" -H "content-type: application/json" "$O/api/replies" \
  -d '{"replyTo":"m3","text":"The prefix is hard-coded in two places.","ask":[{"question":"Where should it live?","options":["In the route table","In an env variable"]}]}'
```

The page shows the choices under your message, with room for another answer; `"multiple": true` on a question lets several be picked. The answer comes back as an ordinary follow-up on that thread, the picked option as its text, or one line per question when there are several. Don't set a state with it: the thread stays open until you have the answer.

## Saying what you're doing

While you work on something the page sent, tell it where you are, a short line at each step:

```
curl -s -X POST -H "Authorization: Bearer $T" -H "content-type: application/json" "$O/api/activity" \
  -d '{"replyTo":"m3","text":"Running the unit tests"}'
```

The page shows the line in its bottom bar, and under the thread when `replyTo` names one, with a small animation. A line said for a thread is also kept on it as a step, so once you have answered the thread shows "3 steps" that open to what you did. Leave `replyTo` out for work that isn't for one thread. A line stands until the next one, until you answer that thread, or for two minutes, so repeat it during long steps; an empty `text` clears it at once. With no line, a thread whose last message is the user's shows one of Claude Code's verbs ("Contemplating…") while a session listens.

`GET /api/messages` returns every message with its anchor, state and batch, for a session that has lost track.

## After a rebuild

When `collect.py` and the guide have been run again into the same folder, `POST /api/reload` with the bearer token. The page refetches. Each thread looks for what it was about in the new build by content (a line by its code, nearest to where it was; a hunk by what it changes; a section by its title) and moves there. What it can't find stays in the user's notes marked as no longer in the diff. A reload that fails keeps what was there and returns 422 with the error.

## Stopping

`POST /api/shutdown` with the bearer token. It also stops by itself after an hour with nothing connected. The messages file stays for the next start.
