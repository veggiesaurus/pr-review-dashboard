import { z } from "zod";

// The payload is what render.py puts in the skill's page, one Layer per PR. The zod schemas pin down only what the
// server relies on or what would break the page if it were wrong; the types below describe every field.

export type Sign = " " | "-" | "+";
// [sign, old line number, new line number, text]; a removed line has no new number, an added one no old number.
export type HunkLine = [sign: Sign, oldNo: number | null, newNo: number | null, text: string];

export type NoiseKind = "whitespace" | "formatting" | "reordered" | "moved";

// A run of changed lines in a hunk, as indexes into hunk.lines, end excluded.
export type Block = {
  start: number;
  end: number;
  noise: NoiseKind | null;
  // Indexes of lines that only changed indentation inside a real change; shown once, as context, unless formatting is shown.
  reindented?: number[];
};

// A run of at least three lines that moved unchanged. line is the other end's first line: "R12" (new) or "L3" (old).
export type Move =
  | { side: "-"; start: number; end: number; to: string; line: string }
  | { side: "+"; start: number; end: number; from: string; line: string };

export type Hunk = {
  id: string;
  // The enclosing scope git printed after the @@, such as a function signature; "" when none.
  header: string;
  oldStart: number;
  newStart: number;
  oldLines: number;
  newLines: number;
  lines: HunkLine[];
  blocks: Block[];
  // Set when every block is noise; such a hunk goes to the "Formatting only" section.
  noise: NoiseKind | null;
  // What the hunk changes, not where it sits, so it survives a rebuild: reviewed ticks are keyed on it.
  sig: string;
  moves: Move[];
  // Names this hunk uses, each with the hunk that defines it.
  uses?: Record<string, string>;
  // Hunks that use names this one defines, each with the names.
  usedBy?: Record<string, string[]>;
  defines?: string[];
  // Indexes into meta.commits of the commits whose lines this hunk holds; only when meta.commitMap.
  commits?: number[];
  // New or changed since meta.lastPass.
  fresh?: boolean;
};

export type FileStatus = "added" | "modified" | "deleted" | "renamed";
export type Category = "implementation" | "test" | "docs" | "generated" | "lockfile" | "agent-guidance" | "localization" | "assets";

// The block a line of a Bruno .bru file sits in. A line n is inside it when open < n <= close.
export type BruBlock = { name: string; open: number; close: number };

export type ReviewFile = {
  id: string;
  path: string;
  oldPath: string;
  status: FileStatus;
  category: Category;
  // Why the file got its category when that wasn't by path, such as ".gitattributes linguist-generated".
  why: string | null;
  // A lock or generated file.
  noise: boolean;
  // Hints that the file needs a careful read: "migration", "dependencies", "auth", "deploy or CI config".
  risk: string[];
  binary?: boolean;
  additions: number;
  deletions: number;
  hunks: Hunk[];
  // Added by the server, which keeps the whole new file: its line count, or null when it holds no text for it
  // (added, deleted, lock and generated files, and very large ones). Fetch lines with GET .../files/:file/lines.
  lineCount: number | null;
  // Added by the server for .bru files it holds the text of.
  bruBlocks?: BruBlock[];
};

export type Checks = {
  pass: number;
  fail: number;
  pending: number;
  cancel: number;
  // Required checks nothing has reported. Only the live answer knows; the build's own count leaves it out.
  expected?: number;
  failing: { name: string; link: string | null }[];
  // CI ran on the pushed head, which isn't the commit this review was built from.
  stale: boolean;
};

// An issue the PR links to. closes is false for "Part of", "Refs" and the like.
export type IssueLink = { ref: string; url: string | null; fetched: boolean; closes: boolean };

// The previous build of the page for this PR: hunks whose sig wasn't in it are fresh.
export type LastPass = { headSha: string; at: string | null; fresh: number; gone: number };

export type Meta = {
  repo: string;
  // Null for a branch with no PR.
  number: number | null;
  title: string;
  url: string | null;
  // The PR description, markdown.
  body: string;
  author: string;
  base: string;
  head: string;
  baseSha: string;
  headSha: string;
  mergeBase: string;
  // Oldest first, each "abc1234 subject" then the message body after a newline.
  commits: string[];
  shas: string[];
  checks: Checks | null;
  issues: IssueLink[];
  // Whether hunks carry commits; collect.py stops mapping past 150 files.
  commitMap: boolean;
  lastPass?: LastPass;
};

export type LineCount = { add: number; del: number };

export type Stats = {
  // Keyed by Category, with how many files each holds.
  categories: Partial<Record<Category, LineCount & { files: number }>>;
  // Formatting-only and re-indented lines in real files.
  noise: LineCount;
  total: LineCount & { files: number };
  // Added lines that only moved, counted where they landed.
  moved: number;
  // Implementation and test lines without formatting noise: the headline number.
  reviewable: number;
};

// A line collect.py flags. kind is one of skip, focus, debug, silenced, any, todo, commented-code, test-removed,
// assertion; label is how the page names it. line is "R12" (new side) or "L3" (old side).
export type Tell = { kind: string; label: string; file: string; hunk: string; line: string; text: string };

// A CI annotation. file, hunk and row ("R12") are set only when it lands on a line this PR changes or shows.
export type Annotation = {
  check: string;
  link: string | null;
  path: string;
  line: number;
  end: number;
  level: "warning" | "failure";
  title: string;
  message: string;
  file?: string;
  hunk?: string;
  row?: string;
};

export type Ready = {
  lines: number;
  files: number;
  band: string;
  tone: "good" | "warn" | "bad";
  implChanged: boolean;
  testsChanged: boolean;
  checks: Checks | null;
};

// hunks is in file order and is the part of the file this section shows.
export type SectionFile = { id: string; hunks: string[] };

export type GuideSection = {
  kind: "guide";
  title: string;
  // Prose with [phrase](f3h2), [phrase](f3) and [phrase](1014:f3h2) links and `code`.
  why: string;
  how: string;
  // A note on what needs a careful read, "" when none.
  risk: string;
  files: SectionFile[];
};

// The closing sections render.py adds: formatting-only hunks, then lock and generated files. No text of their own.
export type ClosingSection = { kind: "formatting" | "generated"; title: string; files: SectionFile[] };

export type Section = GuideSection | ClosingSection;

// How a long PR could be several: each entry lists 1-based section numbers.
export type Split = { note: string; prs: number[][] };

// stack is the stack check's note on a finding another layer explains.
export type DescriptionCheck = {
  checklist?: { claim: string; from: "description" | "issue"; hunks: string[]; stack?: string }[];
  unsupported?: { claim: string; why: string; stack?: string }[];
  missing?: { what: string; hunks: string[]; stack?: string }[];
  issue?: { ask: string; why: string; hunks?: string[]; stack?: string }[];
};

export type Layer = {
  // Added by the server: the PR number, or 0 for a branch without one. Every per-PR route and anchor uses it.
  id: number;
  // Added by the server: the Linear keys this PR names in its title, branch or links, upper case.
  issueKeys: string[];
  // Added by the server: whether this layer has a PR for GitHub and a head commit to search.
  capabilities: { github: boolean; usages: boolean };
  meta: Meta;
  stats: Stats;
  files: ReviewFile[];
  tells: Tell[];
  annotations: Annotation[];
  ready: Ready;
  // Empty when render.py failed (see ReviewResponse.renderError).
  sections: Section[];
  split: Split | null;
  descriptionCheck: DescriptionCheck | null;
  // Up to three things to try by hand, prose like a section's why.
  try: string[];
};

export type StackLayerRow = {
  number: number;
  dir: string;
  title: string;
  url: string | null;
  base: string;
  head: string;
  headSha: string;
  reviewable: number;
  // The layer trails the one below it.
  needsRebase: boolean;
};

// A name defined in one layer's hunk and used on added lines of later layers. Refs are "1014:f5h1".
export type CrossLink = { name: string; from: string; usedIn: string[] };

// Lines one layer adds that a later one removes again from the same file.
export type Churn = { path: string; fromLayer: number; toLayer: number; added: string[]; removed: string[]; lines: number };

export type StackIssue = {
  kind: "churn" | "placement" | "order" | "description" | "other";
  layers: number[];
  // Prose with [phrase](1014:f3h2) links.
  problem: string;
  fix?: string;
};

// stack-guide.json from the stack check: a summary per layer, plain text, and what only shows across the stack.
export type StackCheck = { layers: { number: number; summary: string }[]; issues: StackIssue[] };

export type StackInfo = {
  repo: string;
  // The PR the stack was collected from; the page opens on it.
  focus: number | null;
  // Bottom first.
  layers: StackLayerRow[];
  // PRs where the stack forks above its top layer.
  forks: number[];
  links: CrossLink[];
  churn: Churn[];
  check: StackCheck | null;
};

export type ReviewResponse = {
  stack: StackInfo | null;
  // Bottom first, as in the stack; one entry for a single PR.
  layers: Layer[];
  // What render.py said when it failed, such as a guide with problems or no guide yet. The layers then have
  // no sections, split, description check or things to try.
  renderError: string | null;
  linear: boolean;
};

const hunkLineSchema = z.tuple([z.enum([" ", "-", "+"]), z.number().int().nullable(), z.number().int().nullable(), z.string()]);

const hunkSchema = z.looseObject({
  id: z.string().regex(/^f\d+h\d+$/),
  header: z.string().nullish(),
  oldStart: z.number(),
  newStart: z.number(),
  lines: z.array(hunkLineSchema),
  blocks: z.array(z.looseObject({ start: z.number().int(), end: z.number().int() })).default([]),
  moves: z.array(z.looseObject({ side: z.enum(["-", "+"]), start: z.number().int(), end: z.number().int() })).default([]),
});

const fileSchema = z.looseObject({
  id: z.string().regex(/^f\d+$/),
  path: z.string(),
  status: z.string(),
  hunks: z.array(hunkSchema),
  newText: z.array(z.string()).nullish(),
});

const metaSchema = z.looseObject({
  repo: z.string().nullish(),
  // Passed to gh, so only a plain positive number.
  number: z.number().int().positive().nullish(),
  title: z.string().default(""),
  head: z.string().nullish(),
  // Passed to git grep, so only a full sha.
  headSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullish(),
  issues: z.array(z.looseObject({ ref: z.unknown(), url: z.string().nullish() })).default([]),
});

const sectionSchema = z.looseObject({
  kind: z.enum(["guide", "formatting", "generated"]),
  title: z.string(),
  files: z.array(z.object({ id: z.string(), hunks: z.array(z.string()) })),
});

export const rawLayerSchema = z.looseObject({
  meta: metaSchema,
  files: z.array(fileSchema),
  tells: z.array(z.looseObject({ file: z.string(), line: z.string() })).default([]),
  annotations: z.array(z.looseObject({ path: z.string(), line: z.number() })).default([]),
  sections: z.array(sectionSchema).default([]),
  split: z.looseObject({ prs: z.array(z.array(z.number().int())) }).nullish(),
  descriptionCheck: z.looseObject({}).nullish(),
  try: z.array(z.string()).default([]),
});

export const rawStackSchema = z.looseObject({
  repo: z.string(),
  focus: z.number().int().nullish(),
  layers: z.array(z.looseObject({ number: z.number().int().positive(), dir: z.string() })).min(1),
  forks: z.array(z.number()).default([]),
  links: z.array(z.looseObject({ from: z.string(), usedIn: z.array(z.string()) })).default([]),
  churn: z.array(z.looseObject({})).default([]),
  check: z.looseObject({ layers: z.array(z.looseObject({})).default([]), issues: z.array(z.looseObject({})).default([]) }).nullish(),
});

export type RawLayer = z.infer<typeof rawLayerSchema>;
