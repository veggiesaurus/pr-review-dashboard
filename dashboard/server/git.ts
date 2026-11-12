import type { CommitDetail, UsagesResponse } from "../shared/live";
import { run } from "./exec";

const LIMIT = 60;

export async function usages(repo: string, sha: string, query: string): Promise<UsagesResponse> {
  const result = await run(["git", "-C", repo, "grep", "-n", "-I", "-F", "-w", "-z", "-e", query, sha, "--"], repo);
  if (result.code > 1) {
    return { matches: [], more: false, error: result.stderr.trim().slice(0, 300) || "git grep failed" };
  }
  const matches = [];
  for (const row of result.stdout.split("\n")) {
    // With -z a row is "<sha>:<path>\0<line>\0<text>".
    const [name, line, ...text] = row.split("\0");
    if (!name || !line) {
      continue;
    }
    matches.push({ path: name.slice(sha.length + 1), line: Number(line), text: text.join("\0").slice(0, 240) });
  }
  return { matches: matches.slice(0, LIMIT), more: matches.length > LIMIT, error: null };
}

const SHA = /^[0-9a-f]{40}$/;

// What `git log --format=%x00%H%x01%an%x01%aI --shortstat` prints: a record per commit, then its totals when it has any.
export function parseCommits(stdout: string): CommitDetail[] {
  return stdout
    .split("\0")
    .filter(record => record.trim())
    .map(record => {
      const [head = "", ...rest] = record.trim().split("\n");
      const [sha = "", author = "", at = ""] = head.split("\x01");
      const stat = rest.join("\n");
      const count = (pattern: RegExp) => Number(pattern.exec(stat)?.[1] ?? 0);
      return { sha, author, at, add: count(/(\d+) insertion/), del: count(/(\d+) deletion/) };
    });
}

// Author, date and size of each commit of a layer. A commit the clone doesn't hold leaves the list empty.
export async function commitDetails(repo: string, shas: string[]): Promise<CommitDetail[]> {
  const wanted = shas.filter(sha => SHA.test(sha));
  if (wanted.length === 0) {
    return [];
  }
  const format = "--format=%x00%H%x01%an%x01%aI";
  const result = await run(["git", "-C", repo, "log", "--no-walk=unsorted", format, "--shortstat", ...wanted, "--"], repo);
  return result.code === 0 ? parseCommits(result.stdout) : [];
}
