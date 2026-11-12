import type { Layer, ReviewResponse } from "../shared/payload";
import { findRefs, type Ref, refId } from "../shared/refs";
import type { AppDeps } from "./app";
import { linearTeamKeys } from "./linear";

// How many of each kind the server will look up for one review.
export const REF_CAP = 60;

export type Source = { text: string; repo: string | null };
export type Found = { named: string[]; linear: string[]; github: Map<string, Ref> };

const strings = (...values: unknown[]) => values.filter((value): value is string => typeof value === "string" && value !== "");

// Every piece of a layer's text the page shows through Prose or Markdown. The payload's schema is loose, so a missing
// list is read as empty.
function layerTexts(layer: Layer): string[] {
  const { meta, descriptionCheck: check } = layer;
  return strings(
    meta.title,
    meta.body,
    ...(meta.commits ?? []),
    ...(meta.issues ?? []).flatMap(issue => [issue.ref, issue.url]),
    ...(layer.sections ?? []).flatMap(section => (section.kind === "guide" ? [section.title, section.why, section.how, section.risk] : [])),
    ...(layer.try ?? []),
    layer.split?.note,
    ...(check?.checklist ?? []).flatMap(x => [x.claim, x.stack]),
    ...(check?.unsupported ?? []).flatMap(x => [x.claim, x.why, x.stack]),
    ...(check?.missing ?? []).flatMap(x => [x.what, x.stack]),
    ...(check?.issue ?? []).flatMap(x => [x.ask, x.why, x.stack]),
  );
}

export function reviewSources(review: Pick<ReviewResponse, "layers" | "stack">): Source[] {
  const sources = review.layers.flatMap(layer => layerTexts(layer).map(text => ({ text, repo: layer.meta.repo || null })));
  const stack = review.stack;
  if (stack) {
    const texts = strings(
      ...stack.layers.map(row => row.title),
      ...(stack.check?.layers ?? []).map(row => row.summary),
      ...(stack.check?.issues ?? []).flatMap(issue => [issue.problem, issue.fix]),
    );
    sources.push(...texts.map(text => ({ text, repo: stack.repo })));
  }
  return sources;
}

// The references in the sources, in order, each once. named are the keys the PR itself names, which always count.
export function collectRefs(sources: Source[], named: string[]): Found {
  const linear = new Set<string>();
  const github = new Map<string, Ref>();
  for (const { text, repo } of sources) {
    for (const ref of findRefs(text, repo)) {
      if (ref.kind === "linear") {
        linear.add(ref.key);
      } else if (github.size < REF_CAP) {
        github.set(refId(ref), ref);
      }
    }
  }
  return { named, linear: [...linear], github };
}

// The references this review's own text holds: the payload's text and Claude's replies, never what the page sends.
export class RefIndex {
  private memo: { response: unknown; replies: number; found: Found } | null = null;
  private teams: Promise<Set<string> | null> | null = null;

  constructor(private readonly deps: Pick<AppDeps, "review" | "store" | "linearKey" | "fetcher">) {
    deps.review.onChange(() => {
      this.memo = null;
    });
  }

  found(): Found {
    const { review, store } = this.deps;
    const replies = store.messages.filter(message => message.from === "claude");
    const response = review.response;
    if (this.memo?.response !== response || this.memo.replies !== replies.length) {
      const repoOf = (layer: number | undefined) => (layer !== undefined ? review.layer(layer) : response.layers[0])?.meta.repo || null;
      const sources = [
        ...reviewSources(response),
        ...replies.map(message => ({ text: message.text, repo: repoOf("layer" in message.anchor ? message.anchor.layer : undefined) })),
      ];
      this.memo = { response, replies: replies.length, found: collectRefs(sources, review.issueKeys()) };
    }
    return this.memo.found;
  }

  // Keys from the text count only when the workspace has a team with that key, when Linear says which teams it has.
  async linear(): Promise<string[]> {
    const { named, linear } = this.found();
    let extra = linear.filter(key => !named.includes(key));
    if (extra.length > 0) {
      this.teams ??= linearTeamKeys(this.deps.linearKey, this.deps.fetcher);
      const teams = await this.teams;
      if (teams) {
        extra = extra.filter(key => teams.has(key.slice(0, key.indexOf("-"))));
      } else {
        this.teams = null;
      }
    }
    return [...named, ...extra].slice(0, REF_CAP);
  }

  github(): Map<string, Ref> {
    return this.found().github;
  }
}

const indexes = new WeakMap<object, RefIndex>();

// One index per app, shared by the Linear and GitHub routes.
export function refIndex(deps: AppDeps): RefIndex {
  let index = indexes.get(deps.review);
  if (!index) {
    index = new RefIndex(deps);
    indexes.set(deps.review, index);
  }
  return index;
}
