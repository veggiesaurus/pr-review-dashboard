#!/usr/bin/env python3
"""Build a small repo with a feature branch and a review page for it, for the browser smoke test.

Usage: fixture.py OUT

Writes OUT/repo (the repo), OUT/work (what collect.py writes, plus a guide, a description check and the page
at OUT/work/page.html) and OUT/stack, a two-layer stack page made from copies of it. The branch has three commits, moves a function between files, edits code, skips a
test, makes formatting-only changes, and is then amended once and collected again, so the page has a last pass to compare with.
"""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "..", "skills", "pr-review-guide", "scripts")

UTIL = '''export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function titleCase(text: string): string {
  return text.replace(/\\b\\w/g, c => c.toUpperCase());
}
'''
POSTS = '''import { slugify } from "./util";

export function postPath(title: string): string {
  return `/posts/${slugify(title)}`;
}
'''
FORMAT = '''export const LIMIT = 20;
export const ORDER = "desc";
'''
TEST = '''import { postPath } from "../src/posts";

it("builds a path", () => {
  expect(postPath("Hello World")).toBe("/posts/hello-world");
});
'''


def sh(cwd, *args):
    subprocess.run(args, cwd=cwd, check=True, capture_output=True)


def write(repo, path, text):
    full = os.path.join(repo, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as fh:
        fh.write(text)


def commit(repo, msg):
    sh(repo, "git", "add", "-A")
    sh(repo, "git", "commit", "-q", "-m", msg)


def collect(repo, work):
    r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "collect.py"), "--repo", repo, "--base", "main",
                        "--head", "feature", "--out", work], capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr)
    return r.stdout


def main():
    out = os.path.abspath(sys.argv[1])
    repo, work = os.path.join(out, "repo"), os.path.join(out, "work")
    os.makedirs(repo)
    sh(repo, "git", "init", "-q", "-b", "main")
    sh(repo, "git", "config", "user.email", "test@example.com")
    sh(repo, "git", "config", "user.name", "Test")
    sh(repo, "git", "config", "commit.gpgsign", "false")
    write(repo, "src/util.ts", UTIL)
    write(repo, "src/posts.ts", POSTS)
    write(repo, "tests/posts.test.ts", TEST)
    write(repo, "src/format.ts", FORMAT)
    commit(repo, "initial")
    sh(repo, "git", "checkout", "-q", "-b", "feature")
    # 1: move slugify into its own file
    write(repo, "src/util.ts", UTIL.split("export function titleCase")[0].split("export function slugify")[0]
          + "export function titleCase" + UTIL.split("export function titleCase")[1])
    write(repo, "src/slug.ts", UTIL.split("\n\nexport function titleCase")[0] + "\n")
    write(repo, "src/posts.ts", POSTS.replace('"./util"', '"./slug"'))
    commit(repo, "moves slugify into its own file")
    # 2: change behaviour
    write(repo, "src/posts.ts", POSTS.replace('"./util"', '"./slug"').replace("`/posts/${slugify(title)}`",
                                                                              "`/blog/${slugify(title)}`"))
    commit(repo, "serves posts under /blog")
    # 3: a test left skipped
    write(repo, "tests/posts.test.ts", TEST.replace('it("builds', 'it.skip("builds').replace("/posts/", "/blog/")
          + '\nit("keeps digits", () => {\n  console.log(postPath("v2"));\n  expect(postPath("v2")).toBe("/blog/v2");\n});\n')
    write(repo, "src/format.ts", FORMAT.replace(";", ""))
    commit(repo, "updates the tests")
    collect(repo, work)
    # A second pass: one more change, so the page has something new since the last one.
    # and a formatting-only edit inside the same hunk
    util = open(os.path.join(repo, "src/util.ts")).read().replace("c => c.toUpperCase()", "(c) => c.toUpperCase()")
    write(repo, "src/util.ts", util + "\nexport const MAX_TITLE = 80;\n")
    commit(repo, "caps title length")
    print(collect(repo, work))
    sys.path.insert(0, SCRIPTS)
    import collect as C
    data = json.load(open(os.path.join(work, "hunks.json")))
    # CI annotations need a GitHub check run, so two stand-ins: one on a changed line and one elsewhere.
    data["annotations"] = C.place_annotations(data["files"], [
        {"check": "lint", "link": None, "path": "src/posts.ts", "line": 4, "end": 4, "level": "warning",
         "title": "prefer-template", "message": "Unexpected string concatenation."},
        {"check": "lint", "link": None, "path": "src/other.ts", "line": 9, "end": 9, "level": "failure",
         "title": "no-undef", "message": "'x' is not defined."}])
    json.dump(data, open(os.path.join(work, "hunks.json"), "w"))
    ids = {f["path"]: f["id"] for f in data["files"]}
    guide = {"sections": [
        {"title": "Serve under a new prefix", "why": "Post links now [start with /blog](%s)." % ids["src/posts.ts"],
         "how": "The path builder changes its prefix and the tests follow.", "items": [ids["src/posts.ts"], ids["tests/posts.test.ts"]],
         "risk": "Old /posts links stop resolving."},
        {"title": "Give slugs their own module", "why": "Slug code [moves out](%s) of the shared helpers." % ids["src/slug.ts"],
         "how": "The function is unchanged.", "items": [ids["src/slug.ts"], ids["src/util.ts"]]},
    ], "try": ["Open an old [post link](%s) and check what it does now." % ids["src/posts.ts"]]}
    json.dump(guide, open(os.path.join(work, "guide.json"), "w"))
    hunk = next(h["id"] for f in data["files"] if f["path"] == "src/posts.ts" for h in f["hunks"])
    desc = {"checklist": [{"claim": "posts are served under /blog", "from": "description", "hunks": [hunk]}],
            "unsupported": [{"claim": "old links redirect", "why": "Nothing redirects /posts."}],
            "missing": [{"what": "a title length cap", "hunks": [ids["src/util.ts"] + "h1"]}]}
    json.dump(desc, open(os.path.join(work, "description.json"), "w"))
    render(work)
    # A stack page from two copies of the same layer, numbered as PRs, for the stack's own code paths.
    stack = os.path.join(out, "stack")
    layers = []
    for n in (11, 12):
        shutil.copytree(work, os.path.join(stack, str(n)))
        d = json.load(open(os.path.join(stack, str(n), "hunks.json")))
        d["meta"].update(number=n, repo="o/r", title=f"layer {n}")
        json.dump(d, open(os.path.join(stack, str(n), "hunks.json"), "w"))
        layers.append({"number": n, "dir": str(n), "title": f"layer {n}", "url": None, "base": "main", "head": f"l{n}",
                       "headSha": d["meta"]["headSha"], "reviewable": 22, "needsRebase": False})
    link = {"name": "slugify", "from": f"11:{ids['src/slug.ts']}h1", "usedIn": [f"12:{hunk}"]}
    json.dump({"repo": "o/r", "focus": 12, "layers": layers, "forks": [], "links": [link], "churn": []},
              open(os.path.join(stack, "stack.json"), "w"))
    render(stack)


def render(where):
    r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "render.py"), where], capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stdout + r.stderr)
    print(r.stdout.strip())


if __name__ == "__main__":
    main()
