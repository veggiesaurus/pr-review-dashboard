import type { Database } from "bun:sqlite";

import {
  type Activity,
  type Finding,
  type Message,
  type NewMessage,
  type NoteState,
  type Push,
  type Reply,
  type SessionInfo,
  settled,
  type ThreadEvent,
} from "../shared/messages";
import { noteOrder } from "../shared/order";
import { DISMISS_TEXT, type DismissReason, fixable, type ReviewEffort } from "../shared/reviews";
import { prKey, TICK_PREFIX } from "../shared/ticks";
import { findingAnchor, reanchor, resolveAnchor } from "./anchors";
import { openDb } from "./db";
import { chatFrame, fixFrames, notesFrames, recheckFrames, reviewFrame } from "./format";
import type { Review } from "./review";

// A frame for the session and the messages it carries; n is its row, kept until the session is heard from.
type Pending = { n: number; frame: string; ids: string[] };
// What a thread notes when the session settles it; starting work and answering show as steps and messages already.
const STATE_NOTES: Partial<Record<NoteState, string>> = { done: "Marked done", declined: "Declined" };

// The review as the session's frames name it, as the skill's page does.
function scopeOf(review: Review) {
  const { stack, layers } = review.response;
  if (stack) {
    return `${stack.repo} ${layers.map(layer => `#${layer.id}`).join(", ")}, a stack`;
  }
  const meta = layers[0]?.meta;
  if (!meta) {
    return "this review";
  }
  const sha = (meta.headSha ?? "").slice(0, 7);
  return meta.number ? `${meta.repo}#${meta.number} at ${sha}` : `${meta.repo} ${meta.head} at ${sha}`;
}

export type StoreOptions = {
  // Where messages and ticks are kept between runs; in memory when left out.
  db?: Database;
  // GitHub's number for the stack under review, which stays the same while its layers come and go.
  stack?: number;
  // The clone, named in a review request so the session knows where the code is.
  repo?: string;
  // How long the session's line on what it's doing stands before it lapses.
  activityMs?: number;
};

export class Store {
  messages: Message[] = [];

  private pending: Pending[] = [];
  // Written to a session that hasn't been heard from since: they go again if it leaves without a word.
  private unheard: Pending[] = [];
  private readonly pageSinks = new Set<(push: Push) => void>();
  private readonly sessionSinks = new Set<(frame: string) => void>();
  private readonly waiters = new Set<(text: string) => void>();
  private activity: Activity | null = null;
  private activityTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly db: Database;
  // Every thread is kept with the PR it is about and, in a stack, the stack. A review shows the threads of its
  // PRs and of its stack, so they follow a PR into another review and stay with a stack whose layers change.
  private readonly stack: string | null;
  // What each row held when it was last written, so a save writes only the messages that changed.
  private readonly written = new Map<string, string>();

  constructor(
    private readonly review: Review,
    private readonly options: StoreOptions = {},
  ) {
    this.db = options.db ?? openDb();
    const { stack } = review.response;
    this.stack = stack && options.stack ? `${stack.repo} stack ${options.stack}` : null;
    this.restore();
    review.onChange(() => this.reanchorAll());
  }

  get listening() {
    return this.sessionSinks.size > 0 || this.waiters.size > 0;
  }

  // What the page is told about the session. Its last word on what it's doing only counts while it is listening.
  get session(): SessionInfo {
    return { listening: this.listening, activity: this.listening ? this.activity : null };
  }

  // The session's own line on what it is doing now. It lapses by itself, so a session that forgets to say it
  // has stopped, or dies, doesn't leave the page claiming it is still at work.
  setActivity(text: string, replyTo?: string) {
    clearTimeout(this.activityTimer);
    const line = text.replace(/\s+/g, " ").trim().slice(0, 200);
    const thread = replyTo ? this.root(replyTo) : null;
    this.activity = line ? { text: line, thread: thread?.id ?? null, at: new Date().toISOString() } : null;
    // A line said for a thread is also kept on it, so what Claude did can be read back once it has moved on.
    if (line && thread) {
      this.log(thread, "step", line);
      this.notify("messages");
    }
    if (this.activity) {
      this.activityTimer = setTimeout(() => this.setActivity(""), this.options.activityMs ?? 120_000);
      this.activityTimer.unref?.();
    }
    this.notify("session");
  }

  get connected() {
    return this.pageSinks.size > 0 || this.listening;
  }

  addPageSink(sink: (push: Push) => void) {
    this.pageSinks.add(sink);
    return () => {
      this.pageSinks.delete(sink);
    };
  }

  addSessionSink(sink: (frame: string) => void) {
    // A listener where there was none may be a new session: it gets what the last one never answered for.
    if (!this.listening) {
      this.requeue();
      this.reoffer();
    }
    this.sessionSinks.add(sink);
    this.flush();
    this.notify("session");
    return () => {
      this.sessionSinks.delete(sink);
      if (this.sessionSinks.size === 0) {
        this.requeue();
        this.flush();
      }
      this.notify("session");
    };
  }

  // Something came from the session after these frames went out, so it has them: a message on its socket for one
  // frame, a request of its own for all of them.
  heard(count = this.unheard.length) {
    const got = this.unheard.splice(0, count);
    if (got.length === 0) {
      return;
    }
    const remove = this.db.query("delete from frames where n = ?");
    for (const { n } of got) {
      remove.run(n);
    }
    const delivered = new Set(got.flatMap(p => p.ids));
    for (const message of this.messages) {
      if (delivered.has(message.id)) {
        message.status = "delivered";
      }
    }
    this.notify("messages");
  }

  private requeue() {
    this.pending.unshift(...this.unheard.splice(0));
  }

  // The long-poll: resolves with whatever is waiting, or with the next thing the page sends.
  wait(signal: AbortSignal): Promise<string> {
    // ponytail: coming back for more answers for the last poll, whoever polls; give polls a cursor if two sessions ever share one.
    this.heard();
    return new Promise(resolve => {
      const waiter = (text: string) => {
        resolve(text);
        this.notify("session");
      };
      signal.addEventListener("abort", () => {
        if (this.waiters.delete(waiter)) {
          waiter("");
        }
      });
      this.waiters.add(waiter);
      this.notify("session");
      this.flush();
    });
  }

  find(id: string) {
    return this.messages.find(m => m.id === id);
  }

  addUserMessage(input: NewMessage): Message | null {
    const parent = input.replyTo ? this.root(input.replyTo) : undefined;
    if (parent === null || parent?.status === "draft") {
      return null;
    }
    const anchor = parent ? parent.anchor : resolveAnchor(this.review, input.anchor ?? { kind: "general" });
    if (anchor === null) {
      return null;
    }
    // A follow-up goes at once, and reopens a thread the session had settled.
    const reopened = parent !== undefined && settled(parent.state);
    if (parent && reopened) {
      this.setState(parent, "open");
      this.log(parent, "note", "Reopened by a follow-up");
    }
    if (parent) {
      parent.archived = undefined;
      if (parent.review?.dismissed) {
        parent.review = { ...parent.review, dismissed: undefined };
      }
    }
    const kind = parent ? "chat" : input.kind;
    const message = this.insert(
      {
        from: "user",
        kind,
        text: input.text,
        anchor,
        replyTo: parent?.id,
        status: kind === "note" ? "draft" : "sent",
        state: "open",
        resolved: false,
        ...(kind === "note" && input.intent && { intent: input.intent }),
        at: new Date().toISOString(),
      },
      parent,
    );
    if (kind === "chat") {
      this.deliver([chatFrame(message, scopeOf(this.review), reopened, this.findingOf(message))], [message.id]);
    }
    this.notify("messages");
    return message;
  }

  // The user asks Claude to review one PR. The request is a chat thread, so the wait and Claude's recommendation
  // show as any other thread does; the findings come back as threads of their own.
  requestReview(layerId: number, effort: ReviewEffort): Message | null {
    const anchor = resolveAnchor(this.review, { kind: "general", layer: layerId });
    if (!anchor) {
      return null;
    }
    const last = this.db.query<{ n: number | null }, []>("select max(review) as n from messages").get();
    const sigs = this.review.layer(layerId)?.files.flatMap(file => file.hunks.map(hunk => hunk.sig));
    const message = this.insert({
      from: "user",
      kind: "chat",
      text: `Review this pull request, at ${effort} effort.`,
      anchor,
      status: "sent",
      state: "open",
      resolved: false,
      review: { n: (last?.n ?? 0) + 1, effort, sigs },
      at: new Date().toISOString(),
    });
    this.deliver([this.reviewFrameFor(message)], [message.id]);
    this.notify("messages");
    return message;
  }

  private layerOf(anchor: Message["anchor"]) {
    return "layer" in anchor && anchor.layer !== undefined ? this.review.layer(anchor.layer) : undefined;
  }

  private reviewFrameFor(request: Message) {
    const layer = this.layerOf(request.anchor);
    const target = layer?.meta.url ?? (layer?.meta.number ? `#${layer.meta.number}` : (layer?.meta.head ?? "the current branch"));
    const before = {
      dismissed: layer ? this.dismissedIn(layer.meta.repo) : [],
      open: this.openFindings().filter(m => m.review?.n !== request.review?.n && this.layerOf(m.anchor) === layer),
    };
    return reviewFrame(request, scopeOf(this.review), target, this.options.repo, before);
  }

  // What the user called wrong or intended in earlier reviews of this repo, newest first, for the next review to leave out.
  private dismissedIn(repo: string) {
    return this.db
      .query<{ body: string }, [string, string, string]>(
        "select body from messages where substr(pr, 1, length(?) + 1) in (? || '#', ? || '@') " +
          "and body ->> '$.review.dismissed' in ('false-positive', 'intentional') order by n desc limit 20",
      )
      .all(repo, repo, repo)
      .map(row => JSON.parse(row.body) as Message);
  }

  // What the review found, each as a thread Claude starts on the line, the file or the PR it is about.
  addFindings(n: number, findings: Finding[]): Message[] | null {
    const request = this.messages.find(m => m.review?.n === n && m.from === "user" && !m.replyTo);
    const layer = request && "layer" in request.anchor ? request.anchor.layer : undefined;
    if (!request || layer === undefined) {
      return null;
    }
    // What earlier reviews of this PR read: a finding on a hunk they had too is one they missed.
    const earlier = new Set(
      this.messages.flatMap(m =>
        m.from === "user" && m.review && m.review.n < n && this.layerOf(m.anchor)?.id === layer ? (m.review.sigs ?? []) : [],
      ),
    );
    const sigOf = (anchor: Message["anchor"]) =>
      anchor.kind === "line"
        ? this.review
            .layer(layer)
            ?.files.find(file => file.id === anchor.file)
            ?.hunks.find(hunk => hunk.id === anchor.hunk)?.sig
        : undefined;
    const threads = findings.flatMap(finding => {
      const line = Number.parseInt(String(finding.line ?? ""), 10);
      const anchor = findingAnchor(this.review, layer, finding.file, line > 0 ? line : undefined);
      if (!anchor) {
        return [];
      }
      // A finding the diff can't show on its line still says where it is.
      const where = anchor.kind === "line" ? "" : `${finding.file}${line > 0 ? `:${line}` : ""}: `;
      const sig = sigOf(anchor);
      return this.insert({
        from: "claude",
        kind: "chat",
        text: `${where}${finding.summary}${finding.failure_scenario ? `\n\n${finding.failure_scenario}` : ""}`,
        anchor,
        status: "delivered",
        state: "open",
        resolved: false,
        review: {
          n,
          severity: finding.severity,
          recommended: finding.recommended || undefined,
          patch: finding.patch?.trim() ? finding.patch : undefined,
          seen: this.layerOf(anchor)?.meta.headSha,
          missed: (sig && earlier.has(sig)) || undefined,
        },
        at: new Date().toISOString(),
      });
    });
    this.notify("messages");
    return threads;
  }

  archiveReview(n: number) {
    const threads = this.messages.filter(m => m.review?.n === n && !m.replyTo);
    for (const thread of threads) {
      thread.archived = true;
    }
    this.notify("messages");
    return threads.length;
  }

  // Findings nobody has settled or put away, on code the diff still has.
  private openFindings() {
    return this.messages.filter(m => m.from === "claude" && !m.replyTo && m.review && !m.resolved && !m.archived && !m.anchor.outdated);
  }

  // The recommended findings of a review with no ask still waiting on them, sent to the session to fix in one go.
  fixRecommended(n: number) {
    if (!this.messages.some(m => m.review?.n === n && !m.replyTo)) {
      return null;
    }
    const findings = this.openFindings().filter(
      m =>
        m.review?.n === n &&
        m.review.recommended &&
        fixable(
          m,
          this.messages.filter(reply => reply.replyTo === m.id),
        ),
    );
    if (findings.length > 0) {
      const at = new Date().toISOString();
      const asks = findings.map(finding =>
        this.insert(
          {
            from: "user",
            kind: "chat",
            text: "Fix this.",
            anchor: finding.anchor,
            replyTo: finding.id,
            status: "sent",
            state: "open",
            resolved: false,
            at,
          },
          finding,
        ),
      );
      this.deliver(
        fixFrames(findings, n, scopeOf(this.review)),
        asks.map(ask => ask.id),
      );
      this.notify("messages");
    }
    return findings.length;
  }

  // At a new head every finding still open goes back to the session once: its fix may be anywhere in the PR.
  private recheck() {
    const stale = this.openFindings().filter(m => m.review?.seen !== this.layerOf(m.anchor)?.meta.headSha);
    for (const finding of stale) {
      finding.review = { n: 0, ...finding.review, seen: this.layerOf(finding.anchor)?.meta.headSha };
      this.log(finding, "note", "Sent back to Claude after a rebuild");
    }
    if (stale.length > 0) {
      this.deliver(recheckFrames(stale, scopeOf(this.review)), []);
    }
  }

  // The frames that ask the session for what one message of the user's wants.
  private framesFor(ask: Message) {
    const scope = scopeOf(this.review);
    if (ask.batch !== undefined) {
      return notesFrames([ask], ask.batch, scope);
    }
    return [ask.review && !ask.replyTo ? this.reviewFrameFor(ask) : chatFrame(ask, scope, false, this.findingOf(ask))];
  }

  // A thread a session said it was working on and never settled is asked again: that session may be gone.
  private reoffer() {
    const left = this.messages.filter(m => !m.replyTo && m.state === "working");
    for (const thread of left) {
      this.setState(thread, "open");
      this.log(thread, "note", "Offered again: the session working on it stopped listening");
      const ask = this.messages.findLast(m => (m.id === thread.id || m.replyTo === thread.id) && m.from === "user");
      for (const frame of ask ? this.framesFor(ask) : []) {
        this.queue(`${frame}\n(offered again: it was being worked on when the session stopped listening; carry on if that was you)`, []);
      }
    }
    if (left.length > 0) {
      this.notify("messages");
    }
  }

  // The review finding a follow-up is on, quoted in its frame.
  private findingOf(message: Message) {
    const thread = message.replyTo ? this.find(message.replyTo) : undefined;
    return thread?.from === "claude" && thread.review ? thread : undefined;
  }

  editDraft(id: string, text: string) {
    const draft = this.messages.find(m => m.id === id && m.status === "draft");
    if (!draft) {
      return null;
    }
    draft.text = text;
    draft.edited = new Date().toISOString();
    this.notify("messages");
    return draft;
  }

  // Reviewed ticks for this review's PRs. They are kept by PR, so the same PR in another review shows them too.
  get ticks(): string[] {
    const mine = this.tickScopes();
    return this.db
      .query<{ key: string }, []>("select key from ticks")
      .all()
      .map(row => row.key)
      .filter(key => mine.some(scope => key.startsWith(scope)));
  }

  setTicks(keys: string[], done: boolean) {
    const mine = this.tickScopes();
    const change = this.db.query(done ? "insert or ignore into ticks (key) values (?)" : "delete from ticks where key = ?");
    this.db.transaction(() => {
      for (const key of keys.filter(key => mine.some(scope => key.startsWith(scope)))) {
        change.run(key);
      }
    })();
    this.notify("ticks");
    return this.ticks;
  }

  private tickScopes() {
    return this.review.response.layers.map(layer => `${TICK_PREFIX}${prKey(layer.meta)}:`);
  }

  // The thread has been on the user's screen, so nothing in it so far is news to them.
  markSeen(id: string) {
    const thread = this.root(id);
    if (!thread) {
      return null;
    }
    thread.seen = this.messages.findLast(m => m.id === thread.id || m.replyTo === thread.id)?.id;
    this.notify("messages");
    return thread;
  }

  setArchived(id: string, archived: boolean, reason?: DismissReason) {
    const thread = this.root(id);
    if (!thread || thread.status === "draft") {
      return null;
    }
    thread.archived = archived || undefined;
    if (thread.review && thread.from === "claude") {
      thread.review = { ...thread.review, dismissed: archived ? reason : undefined };
      if (archived && reason) {
        this.log(thread, "note", `Dismissed: ${DISMISS_TEXT[reason].toLowerCase()}`);
      }
    }
    this.notify("messages");
    return thread;
  }

  deleteDraft(id: string) {
    const before = this.messages.length;
    this.messages = this.messages.filter(m => !(m.id === id && m.status === "draft"));
    this.notify("messages");
    return this.messages.length < before;
  }

  sendDrafts() {
    const drafts = this.messages.filter(m => m.status === "draft").sort(this.pageOrder());
    if (drafts.length > 0) {
      const last = this.db.query<{ batch: number | null }, []>("select max(body ->> '$.batch') as batch from messages").get();
      const batch = (last?.batch ?? 0) + 1;
      const at = new Date().toISOString();
      for (const draft of drafts) {
        draft.status = "sent";
        draft.batch = batch;
        draft.sentAt = at;
      }
      this.deliver(
        notesFrames(drafts, batch, scopeOf(this.review)),
        drafts.map(d => d.id),
      );
      this.notify("messages");
    }
    return drafts.length;
  }

  // Text adds Claude's message to the thread; a state (or the older resolved flag) says what it did with it.
  addReply(reply: Reply): { message: Message | null; thread: Message | null } | null {
    const parent = reply.replyTo ? this.root(reply.replyTo) : undefined;
    if (parent === null) {
      return null;
    }
    const state: NoteState | undefined = reply.state ?? (reply.resolved === undefined ? undefined : reply.resolved ? "done" : "open");
    const became = parent && state && parent.state !== state ? STATE_NOTES[state] : undefined;
    if (parent && state) {
      this.setState(parent, state);
    }
    let message: Message | null = null;
    if (reply.text !== undefined) {
      message = this.insert(
        {
          from: "claude",
          kind: parent?.kind ?? "chat",
          text: reply.text,
          anchor: parent?.anchor ?? { kind: "general", label: null, detail: null, path: null, code: null, loc: null, match: null },
          replyTo: parent?.id,
          status: "delivered",
          state: "open",
          resolved: false,
          ask: reply.ask,
          at: new Date().toISOString(),
        },
        parent,
      );
      // An answer ends the work the session said it was doing on that thread.
      if (this.activity?.thread && this.activity.thread === parent?.id) {
        this.setActivity("");
      }
    }
    // After the message, so the note sits under what Claude said about it.
    if (parent && became) {
      this.log(parent, "note", became);
    }
    this.notify("messages");
    return { message, thread: parent ?? null };
  }

  markPosted(ids: string[], posted: NonNullable<Message["posted"]>, keep: boolean) {
    for (const id of ids) {
      const note = this.find(id);
      if (note) {
        note.posted = posted;
      }
    }
    if (!keep) {
      this.messages = this.messages.filter(m => !(ids.includes(m.id) && m.status === "draft"));
    }
    this.notify("messages");
  }

  // As the skill's page sends notes, in the order the page draws them; the page's own list and Copy notes agree.
  private pageOrder() {
    const order = noteOrder(this.review.response.layers);
    return (a: Message, b: Message) => order(a.anchor, b.anchor) || Number(a.id.slice(1)) - Number(b.id.slice(1));
  }

  // Kept short: the last hundred are what a thread shows.
  private log(thread: Message, kind: ThreadEvent["kind"], text: string) {
    const events = thread.events ?? [];
    if (kind === "step" && events.at(-1)?.kind === "step" && events.at(-1)?.text === text) {
      return;
    }
    thread.events = [...events, { kind, text, at: new Date().toISOString() }].slice(-100);
  }

  private setState(root: Message, state: NoteState) {
    root.state = state;
    root.resolved = settled(state);
  }

  private root(id: string): Message | null {
    const message = this.find(id);
    if (!message) {
      return null;
    }
    return message.replyTo ? (this.find(message.replyTo) ?? message) : message;
  }

  // After a reload each thread looks for what it was about; a reply follows its thread.
  private reanchorAll() {
    if (this.messages.length === 0) {
      return;
    }
    const roots = new Map<string, Message["anchor"]>();
    for (const message of this.messages) {
      if (!message.replyTo) {
        const was = message.anchor.outdated;
        message.anchor = reanchor(this.review, message.anchor);
        // A finding on code the diff no longer has is settled here; the session isn't asked about it.
        if (!was && message.anchor.outdated && message.from === "claude" && message.review && !message.resolved) {
          this.log(message, "note", "Outdated: its code is gone from the diff");
        }
        roots.set(message.id, message.anchor);
      }
    }
    for (const message of this.messages) {
      if (message.replyTo) {
        message.anchor = roots.get(message.replyTo) ?? message.anchor;
      }
    }
    this.recheck();
    this.notify("messages");
  }

  // Kept in the database as well, so a restart sends what no session has answered for.
  private queue(frame: string, ids: string[]) {
    const top = this.review.response.layers.at(-1);
    const row = this.db
      .query<{ n: number }, [string, string | null, string, string]>(
        "insert into frames (pr, stack, frame, ids) values (?, ?, ?, ?) returning n",
      )
      .get(top ? prKey(top.meta) : "", this.stack, frame, JSON.stringify(ids));
    if (!row) {
      throw new Error("the frame wasn't kept");
    }
    this.pending.push({ n: row.n, frame, ids });
  }

  private deliver(frames: string[], ids: string[]) {
    for (const frame of frames) {
      this.queue(frame, ids);
    }
    this.flush();
  }

  // Frames wait here until a session is watching the socket or holding the long-poll open. Going out isn't
  // delivery: a message is delivered once the session is heard from.
  private flush() {
    if (this.pending.length === 0 || !this.listening) {
      return;
    }
    const batch = this.pending;
    this.pending = [];
    this.unheard.push(...batch);
    if (this.sessionSinks.size > 0) {
      for (const { frame } of batch) {
        for (const sink of this.sessionSinks) {
          sink(frame);
        }
      }
    } else {
      const waiters = [...this.waiters];
      this.waiters.clear();
      for (const waiter of waiters) {
        waiter(batch.map(p => p.frame).join("\n\n"));
      }
    }
  }

  notify(type: Push["type"], layer?: number) {
    if (type === "messages") {
      this.save();
    }
    for (const sink of this.pageSinks) {
      sink(layer === undefined ? { type } : { type, layer });
    }
  }

  // Whether a page has its socket open; the CI poller only runs while one does.
  get watching() {
    return this.pageSinks.size > 0;
  }

  // A frame that isn't a message, such as a CI change the page asked the session to hear about.
  tell(frame: string) {
    this.deliver([frame], []);
  }

  // The PR a new thread is kept under: the layer it names, or the top of the review when it is about no one layer.
  private prOf(anchor: Message["anchor"]) {
    const { layers } = this.review.response;
    const named = "layer" in anchor && anchor.layer !== undefined ? this.review.layer(anchor.layer) : undefined;
    const layer = named ?? layers.at(-1);
    return layer ? prKey(layer.meta) : "";
  }

  // The database numbers a message as it goes in, so ids never repeat across reviews. A reply is kept with its thread.
  private insert(fields: Omit<Message, "id">, thread?: Message): Message {
    const body = JSON.stringify(fields);
    const row = thread
      ? this.db
          .query<{ n: number }, [string, number]>(
            "insert into messages (pr, stack, body) select pr, stack, ? from messages where n = ? returning n",
          )
          .get(body, Number(thread.id.slice(1)))
      : this.db
          .query<{ n: number }, [string, string | null, string]>("insert into messages (pr, stack, body) values (?, ?, ?) returning n")
          .get(this.prOf(fields.anchor), this.stack, body);
    if (!row) {
      throw new Error("the message wasn't kept");
    }
    const message = { ...fields, id: `m${row.n}` };
    this.messages.push(message);
    return message;
  }

  private save() {
    const update = this.db.query("update messages set body = ? where n = ?");
    const remove = this.db.query("delete from messages where n = ?");
    const now = new Map(this.messages.map(message => [message.id, JSON.stringify(message)]));
    this.db.transaction(() => {
      for (const [id, body] of now) {
        if (this.written.get(id) !== body) {
          update.run(body, Number(id.slice(1)));
          this.written.set(id, body);
        }
      }
      for (const id of [...this.written.keys()].filter(id => !now.has(id))) {
        remove.run(Number(id.slice(1)));
        this.written.delete(id);
      }
    })();
  }

  // Threads from earlier runs about this review's PRs or its stack, found again in what is loaded now.
  private restore() {
    const prs = JSON.stringify(this.review.response.layers.map(layer => prKey(layer.meta)));
    this.messages = this.db
      .query<{ n: number; body: string }, [string, string | null]>(
        "select n, body from messages where pr in (select value from json_each(?)) or stack = ? order by n",
      )
      .all(prs, this.stack)
      .map(row => ({ ...(JSON.parse(row.body) as Message), id: `m${row.n}` }));
    for (const message of this.messages) {
      this.written.set(message.id, JSON.stringify(message));
    }
    // What no session answered for waits for the next one, as it did before the restart.
    this.pending = this.db
      .query<{ n: number; frame: string; ids: string }, [string, string | null]>(
        "select n, frame, ids from frames where pr in (select value from json_each(?)) or stack = ? order by n",
      )
      .all(prs, this.stack)
      .map(row => ({ n: row.n, frame: row.frame, ids: JSON.parse(row.ids) as string[] }));
    this.reanchorAll();
    // A message sent before frames were kept has none; it gets one made now.
    const kept = new Set(this.pending.flatMap(p => p.ids));
    for (const ask of this.messages.filter(m => m.status === "sent" && !kept.has(m.id))) {
      for (const frame of this.framesFor(ask)) {
        this.queue(frame, [ask.id]);
      }
    }
    this.reoffer();
  }
}
