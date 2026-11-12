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
      const [, start, count] = /^@@ -(\d+)(?:,(\d+))? /.exec(line) ?? [];
      // A hunk that removes nothing names the line it comes after; one that removes names its first removed line.
      edit = { after: count === "0" ? Number(start) : Number(start) - 1, gone: [], add: [] };
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
  const diff = await runner(
    ["git", "-C", tree, "diff", "--no-color", "--no-ext-diff", "-U0", layer.meta.headSha, "--", ...byPath.keys()],
    tree,
  );
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
