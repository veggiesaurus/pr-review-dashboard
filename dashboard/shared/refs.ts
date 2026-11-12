// References to Linear issues and to GitHub pull requests, issues and commits, as they turn up in the review's text.
// The server and the page read text with the same tokenizer, so the page decorates exactly what the server allows.

export type Ref =
  | { kind: "linear"; key: string }
  | { kind: "github"; repo: string; number: number }
  | { kind: "commit"; repo: string; sha: string };

export type InlinePart =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "anchor"; text: string; id: string }
  // A web link, written as [label](https://...) or bare; ref is set when it points at an issue, a PR or a commit.
  | { type: "link"; text: string; href: string; ref: Ref | null }
  // #12, owner/repo#12, FRO-541
  | { type: "ref"; text: string; ref: Ref };

export const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
export const SHA = /^[0-9a-f]{7,40}$/;

const TOKEN = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()[\]`"']+)/g;
const ANCHOR = /^(\d+:)?f\d+(h\d+)?$/;
const TRAILING = /[.,;:!?'"]+$/;
// owner/repo#12, then #12, then an upper-case Linear key, each kept apart from the words around it.
const REFS =
  /(?<![\w./-])([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})#(\d{1,7})\b|(?<![\w&#])#(\d{1,7})\b|(?<![\w-])([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g;
// Linear links a lower-case key that leads a title ("bac-1555: adds the thing"), so the page does too.
const LEADING_KEY = /^([a-z][a-z0-9]{1,9}-\d{1,6})(?=[:\s]|$)/;
const GITHUB_URL =
  /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})\/(?:(?:pull|issues)\/(\d{1,7})(?:\/commits\/([0-9a-f]{7,40}))?|commit\/([0-9a-f]{7,40}))(?=[/?#]|$)/;
const LINEAR_URL = /^https:\/\/linear\.app\/[\w-]{1,60}\/issue\/([A-Za-z][A-Za-z0-9]{1,9}-\d{1,6})(?=[/?#]|$)/;

export function refId(ref: Ref): string {
  switch (ref.kind) {
    case "linear":
      return ref.key;
    case "github":
      return `${ref.repo.toLowerCase()}#${ref.number}`;
    case "commit":
      return `${ref.repo.toLowerCase()}@${ref.sha}`;
  }
}

export function refUrl(ref: Exclude<Ref, { kind: "linear" }>): string {
  return ref.kind === "github" ? `https://github.com/${ref.repo}/issues/${ref.number}` : `https://github.com/${ref.repo}/commit/${ref.sha}`;
}

// How GitHub writes a reference: short within the review's own repository.
export function shortRef(ref: Ref, repo: string | null): string {
  const own = ref.kind !== "linear" && repo !== null && ref.repo.toLowerCase() === repo.toLowerCase();
  switch (ref.kind) {
    case "linear":
      return ref.key;
    case "github":
      return own ? `#${ref.number}` : `${ref.repo}#${ref.number}`;
    case "commit":
      return own ? ref.sha.slice(0, 7) : `${ref.repo}@${ref.sha.slice(0, 7)}`;
  }
}

export function urlRef(url: string): Ref | null {
  const github = GITHUB_URL.exec(url);
  if (github?.[1]) {
    const [, repo, number, prCommit, commit] = github;
    const sha = prCommit ?? commit;
    return sha ? { kind: "commit", repo, sha } : { kind: "github", repo, number: Number(number) };
  }
  const linear = LINEAR_URL.exec(url);
  return linear?.[1] ? { kind: "linear", key: linear[1].toUpperCase() } : null;
}

// Plain text, with no code or links in it, split into text and references. repo is what a bare #12 means.
export function splitRefs(text: string, repo: string | null, leading = false): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  const lead = leading ? LEADING_KEY.exec(text)?.[1] : undefined;
  if (lead) {
    parts.push({ type: "ref", text: lead, ref: { kind: "linear", key: lead.toUpperCase() } });
    last = lead.length;
  }
  const start = last;
  for (const match of text.slice(start).matchAll(REFS)) {
    const [whole, otherRepo, otherNumber, number, key] = match;
    let ref: Ref | null = null;
    if (otherRepo && otherNumber) {
      ref = { kind: "github", repo: otherRepo, number: Number(otherNumber) };
    } else if (number && repo) {
      ref = { kind: "github", repo, number: Number(number) };
    } else if (key) {
      ref = { kind: "linear", key };
    }
    if (!ref) {
      continue;
    }
    const at = start + (match.index ?? 0);
    pushText(parts, text.slice(last, at));
    parts.push({ type: "ref", text: whole, ref });
    last = at + whole.length;
  }
  pushText(parts, text.slice(last));
  return parts.filter(part => part.type !== "text" || part.text);
}

function pushText(parts: InlinePart[], text: string) {
  const previous = parts.at(-1);
  if (previous?.type === "text") {
    previous.text += text;
  } else if (text) {
    parts.push({ type: "text", text });
  }
}

// Inline text: backtick code, [phrase](f3h2) jumps (1014:f3h2 in another layer), web links, bare https URLs and the
// references above. Anything else stays as written. Only https is ever a link.
export function tokenize(source: string, repo: string | null): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  const text = (value: string) => {
    for (const part of splitRefs(value, repo, last === 0 && parts.length === 0)) {
      if (part.type === "text") {
        pushText(parts, part.text);
      } else {
        parts.push(part);
      }
    }
  };
  for (const match of source.matchAll(TOKEN)) {
    const [whole, code, label, target, bare] = match;
    const index = match.index ?? 0;
    text(source.slice(last, index));
    last = index + whole.length;
    if (bare) {
      const trail = TRAILING.exec(bare)?.[0] ?? "";
      const url = bare.slice(0, bare.length - trail.length);
      last -= trail.length;
      if (url.startsWith("https://")) {
        const ref = urlRef(url);
        parts.push({ type: "link", text: ref ? shortRef(ref, repo) : url, href: url, ref });
      } else {
        pushText(parts, url);
      }
    } else if (code !== undefined) {
      parts.push({ type: "code", text: code });
    } else if (label && target && ANCHOR.test(target)) {
      parts.push({ type: "anchor", text: label, id: target });
    } else if (label && target?.startsWith("https://")) {
      parts.push({ type: "link", text: label, href: target, ref: urlRef(target) });
    } else {
      pushText(parts, whole);
    }
  }
  text(source.slice(last));
  return parts;
}

// Every reference in some text, in order, whether written bare, as a URL or as a link.
export function findRefs(source: string, repo: string | null): Ref[] {
  return tokenize(source, repo).flatMap(part => ((part.type === "ref" || part.type === "link") && part.ref ? [part.ref] : []));
}
