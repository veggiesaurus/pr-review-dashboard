// What the server reads live on the page's behalf: GitHub through gh, Linear through its API, usages through git.

// gh's buckets: a check that ran and passed, failed, was cancelled, was skipped (or neutral), or hasn't finished.
// expected is ours: a check the trunk's rules require that nothing has reported for this head, which GitHub's own
// merge box calls "Expected" and which a rollup of the checks that did report says nothing about.
export type CheckBucket = "pass" | "fail" | "pending" | "cancel" | "skipping" | "expected";

export type Check = {
  name: string;
  bucket: CheckBucket;
  // GitHub's word for it: a check run's conclusion once it has one, else its status; a commit status's state.
  state: string;
  link: string | null;
  workflow: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

// A GitHub user. The picture comes from GET /api/github/avatar/:login, so the page never learns its address.
export type GithubPerson = { login: string; avatar: boolean };

export type ReviewState = "approved" | "changes" | "commented" | "dismissed" | "requested";
export type Reviewer = { login: string; avatar: boolean; state: ReviewState; team: boolean };

// A deployment of the head commit, or a link labelled "... Preview" in the description or a comment by the author or a bot.
export type Preview = { label: string; url: string; from: "deployment" | "description" | "comment" };

export type LivePr = {
  // OPEN, MERGED or CLOSED.
  state: string;
  isDraft: boolean;
  reviewDecision: string | null;
  headSha: string;
  // The head the guide was built from, and whether the PR's head has moved past it.
  builtSha: string | null;
  moved: boolean;
  url: string;
  base: string;
  head: string;
  // MERGEABLE, CONFLICTING or UNKNOWN, and GitHub's mergeStateStatus (CLEAN, BEHIND, BLOCKED, DIRTY, UNSTABLE...).
  mergeable: string;
  mergeState: string | null;
  openedAt: string | null;
  author: GithubPerson | null;
  reviewers: Reviewer[];
  previews: Preview[];
};

export type GithubLive = {
  pr: LivePr | null;
  checks: Check[];
  error: string | null;
  // When the server last asked GitHub.
  at: string;
};

// Whether the server tells the Claude session when a layer's checks finish or one fails.
export type CiNotify = { on: boolean };

export type CheckCounts = { pass: number; fail: number; pending: number; total: number };

export type GithubRefInfo =
  | {
      kind: "pr";
      repo: string;
      number: number;
      title: string;
      url: string;
      state: "open" | "draft" | "merged" | "closed";
      author: GithubPerson | null;
      labels: { name: string; color: string | null }[];
      updatedAt: string | null;
      base: string;
      head: string;
      additions: number;
      deletions: number;
      files: number;
      checks: CheckCounts | null;
    }
  | {
      kind: "issue";
      repo: string;
      number: number;
      title: string;
      url: string;
      // closed issues say whether they were done or not planned.
      state: "open" | "completed" | "not-planned" | "closed";
      author: GithubPerson | null;
      labels: { name: string; color: string | null }[];
      updatedAt: string | null;
      comments: number;
    }
  | {
      kind: "commit";
      repo: string;
      sha: string;
      title: string;
      url: string;
      author: GithubPerson | null;
      authorName: string | null;
      updatedAt: string | null;
      additions: number;
      deletions: number;
      files: number | null;
      checks: CheckCounts | null;
    };

export type GithubRefResponse = { ref: GithubRefInfo | null; reason: "not-found" | "failed" | null };

// The references the server will answer for: the ones the review's own text holds, up to a cap.
export type AllowedRefs = { linear: string[]; github: string[] };

export type LinearPerson = { name: string; initials: string; color: string | null; avatar: boolean };

export type LinearIssue = {
  identifier: string;
  title: string;
  url: string;
  state: string | null;
  stateType: string | null;
  stateColor: string | null;
  priority: string | null;
  priorityLevel: number | null;
  description: string | null;
  estimate: number | null;
  dueDate: string | null;
  updatedAt: string | null;
  team: string | null;
  assignee: LinearPerson | null;
  creator: LinearPerson | null;
  project: { name: string; url: string | null; color: string | null } | null;
  milestone: string | null;
  cycle: { name: string; startsAt: string | null; endsAt: string | null } | null;
  labels: { name: string; color: string | null }[];
  parent: { identifier: string; title: string; url: string | null } | null;
  subIssues: { total: number; done: number };
};

export type LinearResponse = { issue: LinearIssue | null; reason: "no-key" | "not-found" | "failed" | null };

export type Usage = { path: string; line: number; text: string };
export type UsagesResponse = { matches: Usage[]; more: boolean; error: string | null };

// What git knows about a commit of the layer beyond its message.
export type CommitDetail = { sha: string; author: string; at: string; add: number; del: number };
export type CommitsResponse = { commits: CommitDetail[] };
