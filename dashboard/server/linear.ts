import { z } from "zod";

import type { LinearIssue, LinearPerson, LinearResponse } from "../shared/live";

const KEY = /\b[A-Za-z][A-Za-z0-9]{1,9}-\d{1,6}\b/g;
const HEX = /^#[0-9a-f]{6}$/i;
const IMAGE = /^image\/(png|jpeg|gif|webp|avif)\b/;
const MAX_AVATAR = 2 * 1024 * 1024;
const DONE = ["completed", "canceled"];

const TEAMS_QUERY = "query Teams { teams(first: 250) { nodes { key } } }";
const teamsSchema = z.object({ data: z.object({ teams: z.object({ nodes: z.array(z.object({ key: z.string() })) }) }) });

const QUERY = `query Issue($id: String!) {
  issue(id: $id) {
    identifier title url priority priorityLabel description estimate dueDate updatedAt
    team { name }
    state { name type color }
    assignee { displayName initials avatarUrl avatarBackgroundColor }
    creator { displayName initials avatarUrl avatarBackgroundColor }
    project { name url color }
    projectMilestone { name }
    cycle { number name startsAt endsAt }
    labels(first: 12) { nodes { name color } }
    parent { identifier title url }
    children(first: 50) { nodes { state { type } } }
  }
}`;

const link = z.string().startsWith("https://");
const personSchema = z.object({
  displayName: z.string(),
  initials: z.string().nullish(),
  avatarUrl: z.string().nullish(),
  avatarBackgroundColor: z.string().nullish(),
});

const issueSchema = z.object({
  identifier: z.string(),
  title: z.string(),
  url: link,
  priority: z.number().nullish(),
  priorityLabel: z.string().nullish(),
  description: z.string().nullish(),
  estimate: z.number().nullish(),
  dueDate: z.string().nullish(),
  updatedAt: z.string().nullish(),
  team: z.object({ name: z.string() }).nullish(),
  state: z.object({ name: z.string(), type: z.string(), color: z.string().nullish() }).nullish(),
  assignee: personSchema.nullish(),
  creator: personSchema.nullish(),
  project: z.object({ name: z.string(), url: link.nullish(), color: z.string().nullish() }).nullish(),
  projectMilestone: z.object({ name: z.string() }).nullish(),
  cycle: z
    .object({ number: z.number(), name: z.string().nullish(), startsAt: z.string().nullish(), endsAt: z.string().nullish() })
    .nullish(),
  labels: z.object({ nodes: z.array(z.object({ name: z.string(), color: z.string().nullish() })) }).nullish(),
  parent: z.object({ identifier: z.string(), title: z.string(), url: link.nullish() }).nullish(),
  children: z.object({ nodes: z.array(z.object({ state: z.object({ type: z.string() }).nullish() })) }).nullish(),
});

const responseSchema = z.object({
  data: z.object({ issue: issueSchema.nullish() }).nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type AvatarOf = "assignee" | "creator";
export type Avatar = { type: string; bytes: ArrayBuffer };
// The picture URLs stay here: the page asks for a person's picture by issue and role, never by address.
export type LinearLookup = { response: LinearResponse; avatars: Partial<Record<AvatarOf, string>> };

// Keys the PR itself names: its title, its branch (as Linear links them) and the links collect.py found.
export function issueKeys(meta: { title: string; head?: string | null; issues: { ref?: unknown }[] }): string[] {
  const refs = meta.issues.map(issue => (typeof issue.ref === "string" ? issue.ref : ""));
  const found = [meta.title, meta.head ?? "", ...refs].flatMap(text => text.match(KEY) ?? []);
  return [...new Set(found.map(key => key.toUpperCase()))].slice(0, 5);
}

// Linear's colours end up in inline styles, so only a plain hex gets through.
const colour = (value: string | null | undefined) => (value && HEX.test(value) ? value : null);

// The page shows a few lines of the description as text, so the markdown that would only be noise there comes out.
function plain(markdown: string | null | undefined): string | null {
  const text = (markdown ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(#+|[*+-]|\d+\.)\s+/gm, "")
    .replace(/[*`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 600) || null;
}

function person(raw: z.infer<typeof personSchema> | null | undefined): LinearPerson | null {
  if (!raw) {
    return null;
  }
  return {
    name: raw.displayName,
    initials: (raw.initials || raw.displayName.slice(0, 2)).toUpperCase(),
    color: colour(raw.avatarBackgroundColor),
    avatar: Boolean(raw.avatarUrl),
  };
}

function toIssue(raw: z.infer<typeof issueSchema>): LinearIssue {
  const children = raw.children?.nodes ?? [];
  return {
    identifier: raw.identifier,
    title: raw.title,
    url: raw.url,
    state: raw.state?.name ?? null,
    stateType: raw.state?.type ?? null,
    stateColor: colour(raw.state?.color),
    priority: raw.priorityLabel || null,
    priorityLevel: raw.priority ?? null,
    description: plain(raw.description),
    estimate: raw.estimate ?? null,
    dueDate: raw.dueDate ?? null,
    updatedAt: raw.updatedAt ?? null,
    team: raw.team?.name ?? null,
    assignee: person(raw.assignee),
    creator: person(raw.creator),
    project: raw.project ? { name: raw.project.name, url: raw.project.url ?? null, color: colour(raw.project.color) } : null,
    milestone: raw.projectMilestone?.name ?? null,
    cycle: raw.cycle
      ? { name: raw.cycle.name || `Cycle ${raw.cycle.number}`, startsAt: raw.cycle.startsAt ?? null, endsAt: raw.cycle.endsAt ?? null }
      : null,
    labels: (raw.labels?.nodes ?? []).map(label => ({ name: label.name, color: colour(label.color) })),
    parent: raw.parent ? { identifier: raw.parent.identifier, title: raw.parent.title, url: raw.parent.url ?? null } : null,
    subIssues: { total: children.length, done: children.filter(child => DONE.includes(child.state?.type ?? "")).length },
  };
}

// The workspace's team keys, so a word like UTF-8 in the description is never sent to Linear. Null when unknown.
export async function linearTeamKeys(apiKey: string | undefined, fetcher: typeof fetch = fetch): Promise<Set<string> | null> {
  if (!apiKey) {
    return null;
  }
  try {
    const response = await fetcher("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: apiKey },
      body: JSON.stringify({ query: TEAMS_QUERY }),
      signal: AbortSignal.timeout(10_000),
    });
    const parsed = teamsSchema.safeParse(await response.json());
    return parsed.success ? new Set(parsed.data.data.teams.nodes.map(team => team.key.toUpperCase())) : null;
  } catch {
    return null;
  }
}

export async function linearIssue(key: string, apiKey: string | undefined, fetcher: typeof fetch = fetch): Promise<LinearLookup> {
  const none = (reason: LinearResponse["reason"]): LinearLookup => ({ response: { issue: null, reason }, avatars: {} });
  if (!apiKey) {
    return none("no-key");
  }
  try {
    const response = await fetcher("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: apiKey },
      body: JSON.stringify({ query: QUERY, variables: { id: key } }),
      signal: AbortSignal.timeout(10_000),
    });
    const parsed = responseSchema.safeParse(await response.json());
    const issue = parsed.success ? parsed.data.data?.issue : null;
    if (!issue) {
      const missing = parsed.success && parsed.data.errors?.some(e => /not found/i.test(e.message));
      return none(missing ? "not-found" : "failed");
    }
    const avatars: LinearLookup["avatars"] = {};
    for (const who of ["assignee", "creator"] as const) {
      const url = issue[who]?.avatarUrl;
      if (url) {
        avatars[who] = url;
      }
    }
    return { response: { issue: toIssue(issue), reason: null }, avatars };
  } catch {
    return none("failed");
  }
}

// Only names the public internet would resolve: no address literal, no bare or local name.
const isPublicHost = (host: string) =>
  host.includes(".") && !/^[\d.]+$/.test(host) && !host.includes(":") && !/(^|\.)(localhost|local|internal|lan|home\.arpa)$/i.test(host);

export async function readUpTo(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      const all = Buffer.concat(chunks);
      return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer;
    }
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

// Fetched with no credentials, over https only, one hop at a time so a redirect can't change that. allowHost
// narrows where every hop may go, such as GitHub's avatar hosts.
export async function fetchAvatar(
  start: string,
  fetcher: typeof fetch = fetch,
  allowHost: (host: string) => boolean = isPublicHost,
): Promise<Avatar | null> {
  try {
    let url = new URL(start);
    for (let hop = 0; hop < 4; hop++) {
      if (url.protocol !== "https:" || url.username || url.password || !allowHost(url.hostname)) {
        return null;
      }
      const response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
      const next = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && next) {
        url = new URL(next, url);
        continue;
      }
      const kind = IMAGE.exec(response.headers.get("content-type") ?? "")?.[1];
      if (!response.ok || !kind || Number(response.headers.get("content-length") ?? 0) > MAX_AVATAR) {
        return null;
      }
      const bytes = await readUpTo(response, MAX_AVATAR);
      // The type is rebuilt from the match, so nothing else the host put in its header reaches the browser.
      return bytes ? { type: `image/${kind}`, bytes } : null;
    }
  } catch {
    // an unreachable host is the same as no picture
  }
  return null;
}

// Opened by itself, a picture gets no scripts and no access to the page's origin.
export const avatarHeaders = (avatar: Avatar) => ({
  "Content-Type": avatar.type,
  "Cache-Control": "private, max-age=3600",
  "Content-Security-Policy": "sandbox; default-src 'none'",
});
