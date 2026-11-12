import type { LocalChanges, LocalEdit } from "../shared/local";
import type { Layer } from "../shared/payload";
import type { Runner } from "./comments";

const SHA = /^[0-9a-f]{40}$/;
const MAX_LINES = 3000;

// Paths as git prints them: nothing absolute, nothing that climbs out, nothing git could read as an option.
const safe = (path: string) => !path.startsWith("/") && !path.startsWith("-") && !path.split("/").includes("..") && !/[\0\n]/.test(path);

// Where a branch is checked out: the clone itself or one of its worktrees. Null when it is checked out nowhere.
async function worktreeOf(runner: Runner, repo: string, branch: string): Promise<string | null> {
  const listed = await runner(["git", "-C", repo, "worktree", "list", "--porcelain"], repo);
  if (listed.code !== 0) {
    return null;
  }
  for (const block of listed.stdout.split("\n\n")) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    if (path && block.split("\n").includes(`branch refs/heads/${branch}`)) {
      return path;
    }
  }
  return null;
}

// A hunk that removes nothing names the line it comes after; one that removes names its first removed line.
function afterOf(header: string) {
  const [, start, count] = /^@@ -(\d+)(?:,(\d+))? /.exec(header) ?? [];
  return count === "0" ? Number(start) : Number(start) - 1;
}

// git diff -U0 as edits against the old side's line numbers, by the new side's path.
export function parseEdits(diff: string): { files: Map<string, LocalEdit[]>; truncated: boolean } {
  const files = new Map<string, LocalEdit[]>();
  let edits: LocalEdit[] | null = null;
  let edit: LocalEdit | null = null;
  let lines = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      edits = null;
      edit = null;
    } else if (line.startsWith("+++ b/")) {
      edits = [];
      files.set(line.slice(6), edits);
    } else if (edits && line.startsWith("@@")) {
      edit = { after: afterOf(line), gone: [], add: [] };
      edits.push(edit);
    } else if (edit && (line.startsWith("-") || line.startsWith("+"))) {
      if (++lines > MAX_LINES) {
        return { files, truncated: true };
      }
      (line[0] === "-" ? edit.gone : edit.add).push(line.slice(1));
    }
  }
  return { files, truncated: false };
}

const localDiff = (runner: Runner, tree: string, headSha: string, paths: Iterable<string>) =>
  runner(["git", "-C", tree, "diff", "--no-color", "--no-ext-diff", "-U0", headSha, "--", ...paths], tree);

// What the checkout of a layer's branch has that its reviewed head doesn't, in the files the review shows:
// commits not pushed, a rebase, and anything uncommitted, Claude's fixes among it.
export async function localChanges(runner: Runner, repo: string, layer: Layer): Promise<LocalChanges> {
  const none: LocalChanges = { where: null, files: {} };
  const byPath = new Map(layer.files.filter(file => file.status !== "deleted" && safe(file.path)).map(file => [file.path, file.id]));
  if (!SHA.test(layer.meta.headSha) || byPath.size === 0) {
    return none;
  }
  const tree = await worktreeOf(runner, repo, layer.meta.head);
  if (!tree) {
    return none;
  }
  const diff = await localDiff(runner, tree, layer.meta.headSha, byPath.keys());
  if (diff.code !== 0) {
    return none;
  }
  const { files, truncated } = parseEdits(diff.stdout);
  const out: LocalChanges = { where: tree, files: {}, ...(truncated && { truncated }) };
  for (const [path, edits] of files) {
    const id = byPath.get(path);
    if (id && edits.length > 0) {
      out.files[id] = edits;
    }
  }
  return out;
}

// One edit's hunk of a one-file diff as git printed it, under the file's header, so git can take that change alone back out.
function hunkPatch(diff: string, after: number): string | null {
  const lines = diff.trimEnd().split("\n");
  const start = lines.findIndex(line => line.startsWith("@@") && afterOf(line) === after);
  if (start < 0) {
    return null;
  }
  const next = lines.findIndex((line, i) => i > start && line.startsWith("@@"));
  const header = lines.slice(
    0,
    lines.findIndex(line => line.startsWith("@@")),
  );
  return `${[...header, ...lines.slice(start, next < 0 ? lines.length : next)].join("\n")}\n`;
}

export type Reverted = { ok: true; frame: string } | { ok: false; status: 404 | 409 | 422; error: string };

// Puts the reviewed code back in the checkout at one edit, leaving the rest of the file's local changes alone.
// The edit must still be what the page saw, so a change made since is never thrown away unseen.
export async function revertEdit(runner: Runner, repo: string, layer: Layer, fileId: string, edit: LocalEdit): Promise<Reverted> {
  const file = layer.files.find(f => f.id === fileId);
  const tree = file && safe(file.path) && SHA.test(layer.meta.headSha) ? await worktreeOf(runner, repo, layer.meta.head) : null;
  if (!file || !tree) {
    return { ok: false, status: 404, error: "that file's branch isn't checked out anywhere" };
  }
  const diff = await localDiff(runner, tree, layer.meta.headSha, [file.path]);
  const now = parseEdits(diff.stdout)
    .files.get(file.path)
    ?.find(e => e.after === edit.after);
  const patch = hunkPatch(diff.stdout, edit.after);
  if (diff.code !== 0 || !now || !patch || JSON.stringify([now.gone, now.add]) !== JSON.stringify([edit.gone, edit.add])) {
    return { ok: false, status: 409, error: "the checkout changed since the page read it; look again before reverting" };
  }
  const applied = await runner(["git", "-C", tree, "apply", "-R", "--unidiff-zero", "--whitespace=nowarn", "-"], tree, 15_000, patch);
  if (applied.code !== 0) {
    return { ok: false, status: 422, error: applied.stderr.trim().slice(0, 500) || "git could not take the change back out" };
  }
  const taken = edit.add.slice(0, 20).map(line => `    ${line}`);
  return {
    ok: true,
    frame: [
      `[review page] the user reverted a local change in ${tree}: ${file.path} after line ${edit.after} is the reviewed code again.`,
      ...(taken.length
        ? ["What was taken out:", ...taken, ...(edit.add.length > 20 ? [`    (${edit.add.length - 20} more lines)`] : [])]
        : []),
      "(nothing to answer; don't put it back unless asked)",
    ].join("\n"),
  };
}
