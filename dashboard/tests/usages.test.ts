import { describe, expect, test } from "bun:test";

import { parseCommits } from "../server/git";
import { setup } from "./helpers";

describe("usages", () => {
  test("a usages query has to be one identifier, so it can't become a git option", async () => {
    const { page } = setup();
    for (const query of ["--open-files-in-pager=id", "-e", "a b", "x;rm", ""]) {
      expect((await page(`/api/layers/12/usages?q=${encodeURIComponent(query)}`)).status).toBe(400);
    }
    expect((await page("/api/layers/13/usages?q=slug")).status).toBe(404);
  });

  test("git's log becomes one entry per commit, with no totals for a commit that changed no lines", () => {
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    const log = `\0${a}\x01Ada Lovelace\x012026-11-06T20:34:08+02:00\n\n 2 files changed, 13 insertions(+), 1 deletion(-)\n\0${b}\x01Bo\x012026-11-07T09:00:00Z\n`;
    expect(parseCommits(log)).toEqual([
      { sha: a, author: "Ada Lovelace", at: "2026-11-06T20:34:08+02:00", add: 13, del: 1 },
      { sha: b, author: "Bo", at: "2026-11-07T09:00:00Z", add: 0, del: 0 },
    ]);
  });
});
