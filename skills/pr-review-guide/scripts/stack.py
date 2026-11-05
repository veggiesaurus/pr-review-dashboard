#!/usr/bin/env python3
"""Collect every layer of the open PR stack around one PR, and link the layers.

Usage:
  stack.py --pr N [--repo DIR] --out DIR
  stack.py --self-test

A layer's base branch is the head branch of the layer below, which is how
gh-stack, Graphite and hand-made stacks all look on GitHub, so this needs no
checkout and no stack metadata. Walking down is never ambiguous; walking up
stops where two open PRs share a base, so pass the top PR of the branch you
want.

Writes DIR/<pr>/ for each layer, as collect.py does, and DIR/stack.json: the
layers bottom to top, cross-layer links (a name defined in one layer and used
on an added line of a later one), churn (lines one layer adds and a later one
removes again) and which layers are behind the layer below them.
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import collect as C  # noqa: E402

CHURN_MIN = 3
SUBSTANTIAL = re.compile(r"[A-Za-z_$][\w$]{2}")


def find_stack(prs, number):
    """The open PRs below and above `number`, bottom first, and the PRs a fork above stopped the walk at."""
    # A PR from a fork names a branch in the fork, which can share its name with one here; it is never a layer.
    prs = [p for p in prs if not p.get("isCrossRepository")]
    by_num = {p["number"]: p for p in prs}
    by_head = {p["headRefName"]: p for p in prs}
    if number not in by_num:
        sys.exit(f"#{number} is not an open PR in this repo")
    chain = [by_num[number]]
    while chain[0]["baseRefName"] in by_head and by_head[chain[0]["baseRefName"]] not in chain:
        chain.insert(0, by_head[chain[0]["baseRefName"]])
    while True:
        above = [p for p in prs if p["baseRefName"] == chain[-1]["headRefName"] and p not in chain]
        if len(above) != 1:
            return chain, sorted(p["number"] for p in above) if len(above) > 1 else []
        chain.append(above[0])


def live(data):
    return [h for f in data["files"] if not f["noise"] for h in f["hunks"] if not h["noise"]]


def cross_links(layers):
    """Names defined in exactly one hunk of the whole stack and used on an added line of a later layer."""
    owners = {}
    for k, (n, data) in enumerate(layers):
        for h in live(data):
            for name in h.get("defines", []):
                owners.setdefault(name, set()).add((k, f"{n}:{h['id']}"))
    unique = {name: next(iter(v)) for name, v in owners.items() if len(v) == 1}
    found = {}
    for k, (n, data) in enumerate(layers):
        for h in live(data):
            tokens = {t for r in h["lines"] if r[0] == "+" for t in C.IDENT.findall(C.code_only(r[3]))}
            for name in tokens & unique.keys():
                src_k, src = unique[name]
                if src_k < k:
                    found.setdefault((src_k, src, name), []).append(f"{n}:{h['id']}")
    return [{"name": name, "from": src, "usedIn": uses} for (_k, src, name), uses in sorted(found.items())]


def churn(layers):
    """Lines a layer adds that a later layer removes again from the same file, grouped per file and layer pair."""
    added, groups = {}, {}
    for k, (n, data) in enumerate(layers):
        mine = []
        for f in data["files"]:
            if f["noise"]:
                continue
            for h in f["hunks"]:
                if h["noise"]:
                    continue
                ref = f"{n}:{h['id']}"
                for r in h["lines"]:
                    text = r[3].strip()
                    if len(text) < 12 or not SUBSTANTIAL.search(text):
                        continue
                    if r[0] == "-":
                        hit = added.get((f.get("oldPath") or f["path"], text))
                        if hit:
                            g = groups.setdefault((hit[0], k, f["path"]), {"added": [], "removed": [], "lines": 0})
                            g["lines"] += 1
                            for key, x in (("added", hit[1]), ("removed", ref)):
                                if x not in g[key]:
                                    g[key].append(x)
                    elif r[0] == "+":
                        mine.append(((f["path"], text), (k, ref)))
        added.update(mine)
    return [dict(g, path=path, fromLayer=layers[i][0], toLayer=layers[j][0])
            for (i, j, path), g in sorted(groups.items()) if g["lines"] >= CHURN_MIN]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--pr", type=int)
    p.add_argument("--repo", default=".")
    p.add_argument("--out")
    p.add_argument("--self-test", action="store_true")
    a = p.parse_args()
    if a.self_test:
        return self_test()
    if not a.pr or not a.out:
        p.error("--pr and --out are required")
    repo = os.path.abspath(a.repo)
    prs = C.gh_json(repo, "pr", "list", "--state", "open", "--limit", "500",
                    "--json", "number,title,headRefName,baseRefName,isCrossRepository")
    if prs is None:
        sys.exit(f"gh pr list failed; is gh logged in and is {repo} the right clone?")
    chain, forks = find_stack(prs, a.pr)
    if len(chain) == 1:
        print(f"#{a.pr} is not in a stack: no open PR builds on it or sits under it. Use collect.py for one PR.")
    layers = []
    for pr in chain:
        out = os.path.join(a.out, str(pr["number"]))
        r = subprocess.run([sys.executable, os.path.join(HERE, "collect.py"), "--pr", str(pr["number"]),
                            "--repo", repo, "--out", out], capture_output=True, text=True)
        if r.returncode:
            sys.exit(f"collect.py failed on #{pr['number']}: {r.stderr.strip()}")
        print(f"#{pr['number']}")
        print("  " + r.stdout.strip().replace("\n", "\n  "))
        with open(os.path.join(out, "hunks.json")) as fh:
            layers.append((pr["number"], json.load(fh)))
    rows = []
    for k, (n, data) in enumerate(layers):
        m = data["meta"]
        rows.append({"number": n, "dir": str(n), "title": m["title"], "url": m["url"], "base": m["base"],
                     "head": m["head"], "headSha": m["headSha"], "reviewable": data["stats"]["reviewable"],
                     # The bottom layer trails its trunk as a matter of course; above it, trailing means a rebase.
                     "needsRebase": k > 0 and m["mergeBase"] != m["baseSha"]})
    stack = {"repo": layers[0][1]["meta"]["repo"], "focus": a.pr, "layers": rows, "forks": forks,
             "links": cross_links(layers), "churn": churn(layers)}
    with open(os.path.join(a.out, "stack.json"), "w") as fh:
        json.dump(stack, fh, indent=1)
    print(f"stack of {len(rows)} on {rows[0]['base']}, bottom to top: "
          + " <- ".join(f"#{r['number']}" for r in rows))
    print(f"cross-layer links: {len(stack['links'])}; churn: {len(stack['churn'])} group(s)"
          + "".join(f"; #{r['number']} needs a rebase onto #{rows[k - 1]['number']}"
                    for k, r in enumerate(rows) if r["needsRebase"]))
    if forks:
        print(f"the stack forks above #{rows[-1]['number']} ({', '.join(f'#{n}' for n in forks)}); "
              f"stopped there, so pass the top PR of the branch you want")
    print(f"wrote {a.out}/stack.json and a folder per layer")


def self_test():
    pr = lambda n, base, head: {"number": n, "baseRefName": base, "headRefName": head}
    prs = [pr(1, "main", "a"), pr(2, "a", "b"), pr(3, "b", "c"), pr(9, "main", "x")]
    assert [p["number"] for p in find_stack(prs, 2)[0]] == [1, 2, 3]
    forked = prs + [pr(4, "b", "d")]
    chain, forks = find_stack(forked, 1)
    assert [p["number"] for p in chain] == [1, 2] and forks == [3, 4], (chain, forks)
    assert [p["number"] for p in find_stack(forked, 4)[0]] == [1, 2, 4]
    lookalike = prs + [dict(pr(5, "main", "b"), isCrossRepository=True), dict(pr(6, "c", "z"), isCrossRepository=True)]
    assert [p["number"] for p in find_stack(lookalike, 3)[0]] == [1, 2, 3], "fork PRs are never layers"

    def layer(path, defines, rows):
        return {"files": [{"path": path, "noise": False,
                           "hunks": [{"id": "f1h1", "noise": None, "defines": defines, "lines": rows}]}]}
    low = layer("src/store.ts", ["switchWorkspace", "resetTab"], [["+", None, 1, "export const switchWorkspace = async (workspaceId) => {"],
                                                             ["+", None, 2, "  await refreshSession(workspaceId, 'switch');"],
                                                             ["+", None, 3, "  broadcastChange(workspaceId, 'switch');"],
                                                             ["+", None, 4, "  queryClient.clear('every-key');"]])
    high = layer("src/store.ts", ["resetTab"], [["-", 2, None, "  await refreshSession(workspaceId, 'switch');"],
                                                 ["-", 3, None, "  broadcastChange(workspaceId, 'switch');"],
                                                 ["-", 4, None, "  queryClient.clear('every-key');"],
                                                 ["+", None, 2, "  await switchWorkspace(id); resetTab();"]])
    links = cross_links([(10, low), (11, high)])
    assert links == [{"name": "switchWorkspace", "from": "10:f1h1", "usedIn": ["11:f1h1"]}], links
    assert cross_links([(11, high), (10, low)]) == [], "a use below the definition is not a link"
    got = churn([(10, low), (11, high)])
    assert got == [{"added": ["10:f1h1"], "removed": ["11:f1h1"], "lines": 3, "path": "src/store.ts",
                    "fromLayer": 10, "toLayer": 11}], got
    assert churn([(11, high), (10, low)]) == []
    print("self-test ok")


if __name__ == "__main__":
    main()
