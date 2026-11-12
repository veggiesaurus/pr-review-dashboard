import type { LocalChanges, LocalEdit } from "../shared/local";
import type { Layer } from "../shared/payload";
import type { Runner } from "./comments";
import { flat } from "./format";

const SHA = /^[0-9a-f]{40}$/;
const MAX_LINES = 3000;

// Paths as git prints them: nothing absolute, nothing that climbs out, nothing git could read as an option.
const safe = (path: string) => !path.startsWith("/") && !path.startsWith("-") && !path.split("/").includes("..") && !/[\0\n]/.test(path);

// Where a layer's branch is checked out: the clone itself or one of its worktrees. Null when it is checked out nowhere.
async function worktreeOf(runner: Runner, repo: string, { head: branch, base }: Layer["meta"]): Promise<string | null> {
  // A fork's PR can come from a branch named like its base (main into main), and that checkout is the base, not the PR.
  // ponytail: a fork branch that shares a name with an unrelated local branch still matches; record isCrossRepository to close it.
  if (branch === base?.replace(/^origin\//, "")) {
    return null;
  }
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

const branchOf = (ref: string | undefined) => ref?.replace(/^origin\//, "");

// Where to read a layer's local changes, and for which of its paths. Its own branch's checkout holds for all of them.
// In a stack the work often happens in the top layer's checkout, so failing that the nearest layer above that is
// checked out holds for the paths no layer between changed: those files are the same there as at this layer's head.
async function checkoutFor(runner: Runner, repo: string, layer: Layer, stack: Layer[], paths: string[]) {
  const own = await worktreeOf(runner, repo, layer.meta);
  if (own) {
    return { tree: own, paths };
  }
  const seen = new Set([layer]);
  for (let upper = layer; ; ) {
    const next = stack.find(other => !seen.has(other) && branchOf(other.meta.base) === upper.meta.head);
    if (!next || !SHA.test(next.meta.headSha)) {
      return null;
    }
    seen.add(next);
    upper = next;
    const tree = await worktreeOf(runner, repo, upper.meta);
    if (tree) {
      const changed = await runner(
        ["git", "-C", tree, "diff", "--name-only", "--no-renames", layer.meta.headSha, upper.meta.headSha, "--", ...paths],
        tree,
      );
      const between = new Set(changed.stdout.split("\n"));
      return changed.code === 0 ? { tree, paths: paths.filter(path => !between.has(path)) } : null;
    }
  }
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
export async function localChanges(runner: Runner, repo: string, layer: Layer, stack: Layer[] = [layer]): Promise<LocalChanges> {
  const none: LocalChanges = { where: null, files: {} };
  const byPath = new Map(layer.files.filter(file => file.status !== "deleted" && safe(file.path)).map(file => [file.path, file.id]));
  if (!SHA.test(layer.meta.headSha) || byPath.size === 0) {
    return none;
  }
  const checkout = await checkoutFor(runner, repo, layer, stack, [...byPath.keys()]);
  if (!checkout || checkout.paths.length === 0) {
    return none;
  }
  const { tree } = checkout;
  const diff = await localDiff(runner, tree, layer.meta.headSha, checkout.paths);
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
export async function revertEdit(
  runner: Runner,
  repo: string,
  layer: Layer,
  fileId: string,
  edit: LocalEdit,
  stack: Layer[] = [layer],
): Promise<Reverted> {
  const file = layer.files.find(f => f.id === fileId);
  const checkout =
    file && safe(file.path) && SHA.test(layer.meta.headSha) ? await checkoutFor(runner, repo, layer, stack, [file.path]) : null;
  const tree = checkout?.paths.length ? checkout.tree : null;
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
  const taken = edit.add.slice(0, 20).map(line => `    ${flat(line)}`);
  return {
    ok: true,
    frame: [
      `[review page] the user reverted a local change in ${flat(tree)}: ${flat(file.path)} after line ${edit.after} is the reviewed code again.`,
      ...(taken.length
        ? ["What was taken out:", ...taken, ...(edit.add.length > 20 ? [`    (${edit.add.length - 20} more lines)`] : [])]
        : []),
      "(nothing to answer; don't put it back unless asked)",
    ].join("\n"),
  };
}
