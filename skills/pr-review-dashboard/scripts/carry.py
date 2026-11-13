#!/usr/bin/env python3
"""Carries the last build's guide over to a new build of the same review, so only what changed needs writing.

  carry.py PREV NEW     each a collect.py folder or a stack.py folder, PREV a copy taken before collecting again
  carry.py --self-test

A section keeps every hunk whose change is the same as before (by signature, so a hunk that only moved keeps its
place) under its new id, and the links in its text follow; a link to code that is gone keeps its words. Writes NEW's
guide.json files and stack-guide.json, and prints per layer what no section holds yet and which sections changed.
"""
import json
import os
import re
import sys
from collections import defaultdict, deque

# A whole link to a hunk or file, its words allowed one level of brackets, as in [`arr[0]`](f2h1).
LINK = re.compile(r"\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(((\d+):)?(f\d+(?:h\d+)?)\)")
ID = re.compile(r"^((\d+):)?(f\d+(?:h\d+)?)$")


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def layers(root):
    """Each layer's folder by its PR number, or one unnamed layer for a collect.py folder."""
    if os.path.exists(os.path.join(root, "stack.json")):
        return {str(l["number"]): os.path.join(root, l["dir"]) for l in load(os.path.join(root, "stack.json"))["layers"]}
    return {"": root}


def id_map(prev, new):
    """Old hunk and file ids to new ones: hunks by signature, in order where two make the same change, files by path."""
    free = defaultdict(deque)
    for f in new["files"]:
        for h in f["hunks"]:
            free[h["sig"]].append(h["id"])
    paths = {f["path"]: f["id"] for f in new["files"]}
    out = {}
    for f in prev["files"]:
        out[f["id"]] = paths.get(f["path"])
        for h in f["hunks"]:
            out[h["id"]] = free[h["sig"]].popleft() if free[h["sig"]] else None
    return out


def relink(text, maps, here):
    """Links in a sentence moved to their new ids; one whose code is gone becomes its plain words."""
    def sub(m):
        new = maps.get(m.group(3) or here, {}).get(m.group(4))
        return f"[{m.group(1)}]({m.group(2) or ''}{new})" if new else m.group(1)
    return LINK.sub(sub, text)


def remap(value, maps, here):
    """Every id in a JSON value moved to its new one, wherever it sits: whole strings, list entries, links in text.
    An id whose code is gone leaves its list."""
    if isinstance(value, dict):
        return {k: remap(v, maps, here) for k, v in value.items()}
    if isinstance(value, list):
        out = [remap(v, maps, here) for v in value]
        return [v for v, old in zip(out, value) if not (v is None and isinstance(old, str))]
    if isinstance(value, str):
        m = ID.match(value)
        if m:
            new = maps.get(m.group(2) or here, {}).get(m.group(3))
            return (m.group(1) or "") + new if new else None
        return relink(value, maps, here)
    return value


def sigs_of(data, fid):
    return sorted(h["sig"] for f in data["files"] if f["id"] == fid for h in f["hunks"])


def carry_layer(guide, prev, new, maps, here):
    """The guide with its items and links moved to the new build, plus what is left to place and what changed."""
    ids = maps[here]
    report = {"unplaced": [], "changed": []}
    for n, s in enumerate(guide["sections"], 1):
        items = []
        for item in s.get("items", []):
            moved = ids.get(item)
            whole = "h" not in item
            if moved and (not whole or sigs_of(prev, item) == sigs_of(new, moved)):
                items.append(moved)
            else:
                if moved:
                    items.append(moved)
                report["changed"].append(n)
        if len(items) < len(s.get("items", [])):
            report["changed"].append(n)
        s["items"] = items
        for key in ("why", "how", "risk"):
            if isinstance(s.get(key), str):
                s[key] = relink(s[key], maps, here)
    for key in ("try",):
        if isinstance(guide.get(key), list):
            guide[key] = [relink(t, maps, here) if isinstance(t, str) else t for t in guide[key]]
    placed = set()
    for s in guide["sections"]:
        for item in s["items"]:
            placed |= {h["id"] for f in new["files"] if f["id"] == item for h in f["hunks"]} if "h" not in item else {item}
    report["unplaced"] = [h["id"] for f in new["files"] if not f["noise"] for h in f["hunks"]
                          if not h["noise"] and h["id"] not in placed]
    report["changed"] = sorted(set(report["changed"]))
    return guide, report


def carry(prev_root, new_root):
    prev_layers, new_layers = layers(prev_root), layers(new_root)
    both = [k for k in new_layers if k in prev_layers and os.path.exists(os.path.join(prev_layers[k], "guide.json"))]
    data = {k: (load(os.path.join(prev_layers[k], "hunks.json")), load(os.path.join(new_layers[k], "hunks.json"))) for k in both}
    maps = {k: id_map(*data[k]) for k in both}
    reports = {}
    for k in both:
        guide, report = carry_layer(load(os.path.join(prev_layers[k], "guide.json")), *data[k], maps, k)
        with open(os.path.join(new_layers[k], "guide.json"), "w", encoding="utf-8") as fh:
            json.dump(guide, fh, indent=1, ensure_ascii=False)
        reports[k] = report
        description = os.path.join(prev_layers[k], "description.json")
        if os.path.exists(description):
            with open(os.path.join(new_layers[k], "description.json"), "w", encoding="utf-8") as fh:
                json.dump(remap(load(description), maps, k), fh, indent=1, ensure_ascii=False)
    stack_guide = os.path.join(prev_root, "stack-guide.json")
    if os.path.exists(stack_guide) and len(new_layers) > 1:
        # A stack guide's ids always name their layer.
        with open(os.path.join(new_root, "stack-guide.json"), "w", encoding="utf-8") as fh:
            json.dump(remap(load(stack_guide), maps, None), fh, indent=1, ensure_ascii=False)
    return reports, [k for k in new_layers if k not in both]


def self_test():
    prev = {"files": [{"id": "f1", "path": "a.ts", "noise": False, "hunks": [
        {"id": "f1h1", "sig": "s1", "noise": None}, {"id": "f1h2", "sig": "s2", "noise": None}]},
        {"id": "f2", "path": "b.ts", "noise": False, "hunks": [{"id": "f2h1", "sig": "s3", "noise": None}]}]}
    new = {"files": [{"id": "f1", "path": "b.ts", "noise": False, "hunks": [{"id": "f1h1", "sig": "s3", "noise": None}]},
                     {"id": "f2", "path": "a.ts", "noise": False, "hunks": [
                         {"id": "f2h1", "sig": "s1", "noise": None}, {"id": "f2h2", "sig": "s9", "noise": None}]}]}
    maps = {"": id_map(prev, new)}
    assert maps[""] == {"f1": "f2", "f1h1": "f2h1", "f1h2": None, "f2": "f1", "f2h1": "f1h1"}, maps
    guide = {"sections": [
        {"title": "A", "why": "Does [this](f1h1) and [`arr[0]`](f1h2).", "how": "", "items": ["f1h1", "f1h2"]},
        {"title": "B", "why": "In [b](f2) and [up](12:f4h1).", "how": "", "items": ["f2"]}], "try": ["Open [it](f1h1)."]}
    out, report = carry_layer(guide, prev, new, maps, "")
    assert out["sections"][0]["items"] == ["f2h1"] and out["sections"][0]["why"] == "Does [this](f2h1) and `arr[0]`.", out
    assert out["sections"][1]["items"] == ["f1"] and out["sections"][1]["why"] == "In [b](f1) and up.", out
    assert out["try"] == ["Open [it](f2h1)."]
    assert report == {"unplaced": ["f2h2"], "changed": [1]}, report
    found = {"missing": [{"what": "x", "hunks": ["f1h1", "f1h2"]}], "note": "see [here](f2)"}
    assert remap(found, maps, "") == {"missing": [{"what": "x", "hunks": ["f2h1"]}], "note": "see [here](f1)"}
    print("self-test ok")


def main():
    if sys.argv[1:] == ["--self-test"]:
        return self_test()
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    reports, fresh = carry(sys.argv[1], sys.argv[2])
    for k, r in reports.items():
        name = f"#{k} " if k else ""
        if not r["unplaced"] and not r["changed"]:
            print(f"{name}unchanged: the guide carries over as it is")
        else:
            print(f"{name}to place: {', '.join(r['unplaced']) or 'nothing'}; sections whose code changed: "
                  f"{', '.join(map(str, r['changed'])) or 'none'}")
    for k in fresh:
        print(f"#{k} is new to the stack and needs a guide of its own")


if __name__ == "__main__":
    main()
