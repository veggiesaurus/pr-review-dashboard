import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../server/exec";
import { parseEdits } from "../server/local";
import type { LocalChanges } from "../shared/local";
import { rawReview, setup } from "./helpers";

// A clone whose branch is one commit and one uncommitted edit ahead of the head the review was built from.
async function checkout() {
  const repo = mkdtempSync(join(tmpdir(), "prg-local-"));
  const git = (...args: string[]) =>
    run(
      [
        "git",
        "-C",
        repo,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.com",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ],
      repo,
    );
  await git("init", "-q", "-b", "abc-12-slugs");
  mkdirSync(join(repo, "src"));
  const write = (text: string) => writeFileSync(join(repo, "src/slug.ts"), text);
  write("export function slug(title: string) {\n  return title.trim().toLowerCase();\n}\n");
  writeFileSync(join(repo, "unrelated.ts"), "one\n");
  await git("add", ".");
  await git("commit", "-q", "-m", "reviewed");
  const reviewed = (await git("rev-parse", "HEAD")).stdout.trim();
  write('export function slug(title: string) {\n  return title.trim().toLowerCase();\n}\n\nexport const SEPARATOR = "-";\n');
  await git("commit", "-q", "-am", "not pushed");
  write(
    'export function slug(title: string) {\n  const trimmed = title.trim();\n  return trimmed.toLowerCase();\n}\n\nexport const SEPARATOR = "-";\n',
  );
  writeFileSync(join(repo, "unrelated.ts"), "two\n");
  return { repo, reviewed };
}

describe("what the checkout has that the reviewed head doesn't", () => {
  test("a diff with no context becomes edits against the old side's lines", () => {
    const { files } = parseEdits(
      [
        "diff --git a/a.ts b/a.ts",
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -2 +2,2 @@ fn",
        "-old",
        "+new",
        "+more",
        "@@ -7,0 +9 @@",
        "+added",
        "@@ -9,2 +10,0 @@",
        "-x",
        "-y",
      ].join("\n"),
    );
    expect(files.get("a.ts")).toEqual([
      { after: 1, gone: ["old"], add: ["new", "more"] },
      { after: 7, gone: [], add: ["added"] },
      { after: 8, gone: ["x", "y"], add: [] },
    ]);
  });

  test("the layer's files are compared with where its branch is checked out, unpushed commits and uncommitted edits alike", async () => {
    const { repo, reviewed } = await checkout();
    const raw = structuredClone(rawReview);
    raw.meta.headSha = reviewed;
    const { page, session } = setup({ raw, repo });
    const local = (await (await page("/api/layers/12/local")).json()) as LocalChanges;
    expect(local.where).toBe((await run(["git", "-C", repo, "rev-parse", "--show-toplevel"], repo)).stdout.trim());
    expect(local.files).toEqual({
      f1: [
        {
          after: 1,
          gone: ["  return title.trim().toLowerCase();"],
          add: ["  const trimmed = title.trim();", "  return trimmed.toLowerCase();"],
        },
        { after: 3, gone: [], add: ["", 'export const SEPARATOR = "-";'] },
      ],
    });
    expect((await session("/api/layers/99/local")).status).toBe(404);

    const elsewhere = structuredClone(raw);
    elsewhere.meta.head = "a-branch-checked-out-nowhere";
    const other = setup({ raw: elsewhere, repo });
    expect(await (await other.page("/api/layers/12/local")).json()).toEqual({ where: null, files: {} });
  });

  test("one edit is taken back out of the checkout, and only while it is still what the page saw", async () => {
    const { repo, reviewed } = await checkout();
    const raw = structuredClone(rawReview);
    raw.meta.headSha = reviewed;
    const { page, session } = setup({ raw, repo });
    const revert = (who: typeof page, edit: object) =>
      who("/api/layers/12/local/revert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: "f1", edit }),
      });
    const edit = {
      after: 1,
      gone: ["  return title.trim().toLowerCase();"],
      add: ["  const trimmed = title.trim();", "  return trimmed.toLowerCase();"],
    };

    expect((await session("/api/layers/12/local/revert", { method: "POST" })).status).toBe(403);
    expect((await revert(page, { ...edit, add: ["  something else"] })).status).toBe(409);
    expect((await revert(page, edit)).status).toBe(200);
    expect(readFileSync(join(repo, "src/slug.ts"), "utf8")).toBe(
      'export function slug(title: string) {\n  return title.trim().toLowerCase();\n}\n\nexport const SEPARATOR = "-";\n',
    );
    expect(readFileSync(join(repo, "unrelated.ts"), "utf8")).toBe("two\n");
    expect(await (await session("/api/session/wait")).text()).toContain("reverted a local change");
    expect((await revert(page, edit)).status).toBe(409);
  });
});
