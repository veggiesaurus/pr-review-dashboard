#!/usr/bin/env python3
"""Check a guide against its hunks and render the review page.

Usage:
  render.py WORKDIR [--out PAGE.html] [--check]
  render.py STACKDIR [--out PAGE.html] [--check]
  render.py --self-test

WORKDIR holds hunks.json from collect.py and guide.json from the guide worker.
--check validates only, printing every problem so the worker can fix them in
one go. Without it the page is written to PAGE.html (default WORKDIR/page.html).

guide.json is {"sections": [{"title", "why", "how", "items": [...], "risk"?}],
"split"?: {"note", "prs": [[1, 2], [3]]}}. An item is a hunk id (f3h2) or a
file id (f3), which takes whatever hunks of that file no other item names. why
and how may link phrases as [phrase](f3h2). risk is a short note on what makes
the section risky; split suggests how a large PR could be several, by section
number. An optional description.json from the checker is shown on the page:
{"unsupported": [{"claim", "why"}], "missing": [{"what", "hunks"}], "issue"?: [{"ask", "why"}]}.

A STACKDIR is what stack.py writes: stack.json and one WORKDIR per layer. Every
layer is checked as above, links may reach into another layer as
[phrase](1014:f3h2), and the optional stack-guide.json from the stack check,
{"layers": [{"number", "summary"}], "issues": [{"kind", "layers", "problem",
"fix"}]}, is checked and shown. The page holds every layer, one at a time.
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, "..", "reference", "page-template.html")
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]*)\)")
ID_RE = re.compile(r"^f\d+(h\d+)?$")
sys.path.insert(0, HERE)
import collect as C  # noqa: E402

XID_RE = re.compile(r"^(\d+):(f\d+(?:h\d+)?)$")


def has_id(data, target):
    return any(f["id"] == target or any(h["id"] == target for h in f["hunks"]) for f in data["files"])


def bad_xlink(target, layers):
    """For a link into another layer: None when it is fine, else why not. Unchecked outside a stack."""
    m = XID_RE.match(target)
    if layers is None:
        return None
    if int(m.group(1)) not in layers:
        return f"#{m.group(1)} is not a layer of this stack"
    return None if has_id(layers[int(m.group(1))], m.group(2)) else f"#{m.group(1)} has no {m.group(2)}"


def build_sections(data, guide, layers=None):
    """Resolve the guide's items to hunks per file, returning (sections, problems).

    layers maps each stack layer's number to its hunks.json, to check links into other layers.
    """
    files = {f["id"]: f for f in data["files"]}
    hunk_file = {h["id"]: f for f in data["files"] for h in f["hunks"]}
    problems = []
    raw = guide.get("sections") if isinstance(guide, dict) else None
    if raw is None:
        return [], ['guide.json has no "sections" list']

    claimed = {}
    for i, s in enumerate(raw, 1):
        for item in s.get("items") or []:
            if not isinstance(item, str) or not ID_RE.match(item):
                problems.append(f"section {i}: item {item!r} is not a file id (f3) or hunk id (f3h2)")
            elif "h" in item and item not in hunk_file:
                problems.append(f"section {i}: hunk {item} does not exist")
            elif "h" not in item and item not in files:
                problems.append(f"section {i}: file {item} does not exist")
            elif "h" in item:
                if item in claimed:
                    problems.append(f"hunk {item} is in section {claimed[item]} and section {i}; give it one home")
                claimed[item] = i

    sections, file_claim = [], {}
    for i, s in enumerate(raw, 1):
        for key in ("title", "why", "how"):
            if not str(s.get(key) or "").strip():
                problems.append(f"section {i}: {key} is empty")
        for text in (s.get("why") or "", s.get("how") or ""):
            for phrase, target in LINK_RE.findall(text):
                if XID_RE.match(target):
                    why = bad_xlink(target, layers)
                    if why:
                        problems.append(f"section {i}: link [{phrase}]({target}) points at nothing: {why}")
                elif not ID_RE.match(target) or (target not in files and target not in hunk_file):
                    problems.append(f"section {i}: link [{phrase}]({target}) points at nothing")
        order, per_file = [], {}
        for item in s.get("items") or []:
            if not isinstance(item, str) or not ID_RE.match(item):
                continue
            if "h" in item:
                f = hunk_file.get(item)
                if not f:
                    continue
                hs = [item]
            else:
                f = files.get(item)
                if not f:
                    continue
                if item in file_claim:
                    problems.append(f"file {item} is listed whole in section {file_claim[item]} and section {i}")
                file_claim[item] = i
                hs = [h["id"] for h in f["hunks"] if h["id"] not in claimed and (f["noise"] or not h["noise"])]
                if f["hunks"] and not hs:
                    why = ("only has formatting changes, which go in the closing section"
                           if all(h["noise"] for h in f["hunks"]) else "adds nothing, every hunk of it is named elsewhere")
                    problems.append(f"section {i}: file {item} {why}")
                    continue
                for h in hs:
                    claimed[h] = i
            if f["id"] not in per_file:
                per_file[f["id"]] = []
                order.append(f["id"])
            per_file[f["id"]] += [h for h in hs if h not in per_file[f["id"]]]
        if not order:
            problems.append(f"section {i}: no items")
        ranked = {h["id"]: n for f in data["files"] for n, h in enumerate(f["hunks"])}
        # Implementation before tests and docs inside a section, otherwise the guide's order.
        order.sort(key=lambda fid: files[fid].get("category", "implementation") != "implementation")
        sections.append({
            "kind": "guide", "title": s.get("title", ""), "why": s.get("why", ""), "how": s.get("how", ""),
            "risk": str(s.get("risk") or "").strip(),
            "files": [{"id": fid, "hunks": sorted(per_file[fid], key=ranked.get)} for fid in order],
        })

    hunkless = [f for f in data["files"] if not f["hunks"] and not f["noise"] and f["id"] not in file_claim]
    missing = [h["id"] for f in data["files"] if not f["noise"] for h in f["hunks"]
               if not h["noise"] and h["id"] not in claimed]
    if missing:
        problems.append("hunks in no section: " + ", ".join(missing))
    if hunkless:
        problems.append("files with no line changes in no section (list them by file id): "
                        + ", ".join(f"{f['id']} {f['path']}" for f in hunkless))

    fmt = [{"id": f["id"], "hunks": [h["id"] for h in f["hunks"] if h["id"] not in claimed]}
           for f in data["files"] if not f["noise"]]
    fmt = [x for x in fmt if x["hunks"]]
    # A section may take some hunks of a generated file; the rest still go to the closing section.
    gen = [{"id": f["id"], "hunks": [h["id"] for h in f["hunks"] if h["id"] not in claimed]}
           for f in data["files"] if f["noise"] and f["id"] not in file_claim]
    gen = [x for x in gen if x["hunks"] or not files[x["id"]]["hunks"]]
    if fmt:
        sections.append({"kind": "formatting", "title": "Formatting only", "files": fmt})
    if gen:
        sections.append({"kind": "generated", "title": "Lock and generated files", "files": gen})
    return sections, problems


BANNED = re.compile(r"\u2014|\bseamless(ly)?\b|\brobust\b|\bcomprehensive\b|\bleverag(e|es|ing)\b|\bstreamline", re.I)
CODEY = re.compile(r"[a-z][A-Z]|\w_\w|/|\.(tsx?|jsx?|py|go|sql|json)\b")


def lint(data, sections):
    """Things a section can get wrong that coverage cannot see. Warnings, for the guide worker to weigh."""
    guide = [s for s in sections if s["kind"] == "guide"]
    files = {f["id"]: f for f in data["files"]}
    hunks = {h["id"]: h for f in data["files"] for h in f["hunks"]}
    changed = {hid: sum(1 for r in h["lines"] if r[0] != " ") for hid, h in hunks.items()}
    home = {h: i for i, s in enumerate(guide, 1) for x in s["files"] for h in x["hunks"]}
    stems = {os.path.splitext(os.path.basename(f["path"]))[0].lower() for f in data["files"]}
    stems = {x for x in stems if len(x) >= 4 and x not in ("index", "types", "utils")}
    total = sum(changed[h] for h in home)
    out = []
    for i, s in enumerate(guide, 1):
        mine = [h for x in s["files"] for h in x["hunks"]]
        size = sum(changed[h] for h in mine)
        if len(guide) >= 3 and len(mine) == 1 and size < 6:
            out.append(f"section {i} is one {size}-line hunk; fold it into the section it supports unless it stands alone")
        if len(guide) >= 2 and total >= 200 and size > 0.6 * total:
            out.append(f"section {i} holds {size} of {total} changed lines; check whether it is two things")
        words = set(re.findall(r"[\w./-]+", s["title"]))
        if any(CODEY.search(w) for w in words) or {w.lower() for w in words} & stems:
            out.append(f"section {i} title {s['title']!r} names code; say the outcome instead")
        if all(files[x["id"]]["category"] == "test" for x in s["files"]):
            out.append(f"section {i} is only tests; put them with the behaviour they test")
        text = f"{s['why']} {s['how']}"
        links = LINK_RE.findall(text)
        if not links:
            out.append(f"section {i} links nothing; link the phrase that names the core change")
        for phrase, target in links:
            if XID_RE.match(target):
                continue
            inside = target in mine if "h" in target[1:] else any(x["id"] == target for x in s["files"])
            if not inside:
                out.append(f"section {i} links [{phrase}]({target}), which sits in another section")
        for key in ("why", "how"):
            if len(s[key].split()) > 60:
                out.append(f"section {i} {key} runs to {len(s[key].split())} words; keep it to one or two sentences")
            if BANNED.search(s[key]):
                out.append(f"section {i} {key} uses {BANNED.search(s[key]).group(0)!r}")
        hinted = sorted({r for x in s["files"] for r in files[x["id"]].get("risk", [])})
        if hinted and not s.get("risk"):
            out.append(f"section {i} touches {', '.join(hinted)} code but has no risk note; add one, or leave it "
                       f"if nothing there needs a careful read")
        if len(mine) > 1:
            for h in mine:
                peers = set(hunks[h].get("uses", {}).values()) | set(hunks[h].get("usedBy", {}))
                peers = {p for p in peers if p in home}
                if peers and not any(home[p] == i for p in peers):
                    where = sorted({home[p] for p in peers})
                    out.append(f"{h} is in section {i} but connects only to hunks in section "
                               f"{', '.join(map(str, where))} ({', '.join(sorted(peers))}); check it belongs here")
    if data.get("stats", {}).get("reviewable", 0) > C.SIZE_BANDS[0][0] and len(guide) >= 2 and not data.get("_split"):
        out.append("the PR is long for one review and the guide suggests no split")
    return out


def check_split(data, guide, sections):
    """The suggested split, its problems, and warnings where a PR would use code a later one adds."""
    split = guide.get("split") if isinstance(guide, dict) else None
    if not split:
        return None, [], []
    n = sum(1 for s in sections if s["kind"] == "guide")
    prs = split.get("prs") if isinstance(split, dict) else None
    flat = [x for pr in prs or [] if isinstance(pr, list) for x in pr]
    if not prs or not all(isinstance(pr, list) and pr for pr in prs) or sorted(flat) != list(range(1, n + 1)):
        return None, [f"split.prs must list every section 1 to {n} exactly once, grouped into PRs"], []
    pr_of = {sec: k for k, pr in enumerate(prs, 1) for sec in pr}
    home = {h: i for i, s in enumerate(sections[:n], 1) for x in s["files"] for h in x["hunks"]}
    hunks = {h["id"]: h for f in data["files"] for h in f["hunks"]}
    warnings = set()
    defined_in = {}
    for hid, sec in home.items():
        for name in hunks[hid].get("defines", []):
            defined_in.setdefault(name, set()).add(sec)
    for name, secs in defined_in.items():
        if len({pr_of[x] for x in secs}) > 1:
            where = ", ".join(map(str, sorted(secs)))
            warnings.add(f"split: {name} is defined in sections {where}, which land in different PRs")
    for hid, sec in home.items():
        for name, src in hunks[hid].get("uses", {}).items():
            if src in home and pr_of[home[src]] > pr_of[sec]:
                warnings.add(f"split: PR {pr_of[sec]} uses {name} from section {home[src]}, "
                             f"which lands later in PR {pr_of[home[src]]}")
    return {"note": str(split.get("note") or ""), "prs": prs}, [], sorted(warnings)


def render(data, sections, out, extras=None):
    m = data["meta"]
    title = f"{m['repo'].split('/')[-1]}#{m['number']} guide" if m.get("number") else f"{m['head']} guide"
    return write_page(dict(data, sections=sections, **(extras or {})), title, out)


def write_page(payload, title, out):
    with open(TEMPLATE) as fh:
        page = fh.read()
    blob = json.dumps(payload, separators=(",", ":")).replace("<", "\\u003c")
    page = page.replace("__PRG_TITLE__", title.replace("&", "&amp;").replace("<", "&lt;"), 1)
    page = page.replace("__PRG_DATA__", blob, 1)
    with open(out, "w") as fh:
        fh.write(page)
    return len(page.encode())


def self_test():
    data = {"meta": {}, "files": [
        {"id": "f1", "path": "a.ts", "noise": False, "hunks": [{"id": "f1h1", "noise": None}, {"id": "f1h2", "noise": None}]},
        {"id": "f2", "path": "b.ts", "noise": False, "hunks": [{"id": "f2h1", "noise": None}, {"id": "f2h2", "noise": "whitespace"}]},
        {"id": "f3", "path": "package-lock.json", "noise": True, "hunks": [{"id": "f3h1", "noise": None}]},
    ]}
    ok = {"sections": [
        {"title": "One", "why": "w [x](f1h2)", "how": "h", "items": ["f1h2", "f2"]},
        {"title": "Two", "why": "w", "how": "h", "items": ["f1"]},
    ]}
    secs, probs = build_sections(data, ok)
    assert not probs, probs
    assert [s["kind"] for s in secs] == ["guide", "guide", "formatting", "generated"]
    assert secs[0]["files"] == [{"id": "f1", "hunks": ["f1h2"]}, {"id": "f2", "hunks": ["f2h1"]}]
    assert secs[2]["files"] == [{"id": "f2", "hunks": ["f2h2"]}]
    assert secs[1]["files"] == [{"id": "f1", "hunks": ["f1h1"]}]
    _, probs = build_sections(data, {"sections": [{"title": "One", "why": "w", "how": "h", "items": ["f1h1"]}]})
    assert any("f1h2" in p and "f2h1" in p for p in probs), probs
    _, probs = build_sections(data, {"sections": [
        {"title": "A", "why": "w", "how": "h", "items": ["f1h1", "f2"]},
        {"title": "B", "why": "w [y](f9)", "how": "h", "items": ["f1h1", "f1h2"]}]})
    assert any("give it one home" in p for p in probs) and any("points at nothing" in p for p in probs), probs
    secs, probs = build_sections(data, {"sections": [{"title": "A", "why": "w", "how": "h", "items": ["f1", "f2h1"]}]})
    assert not probs and secs[1] == {"kind": "formatting", "title": "Formatting only", "files": [{"id": "f2", "hunks": ["f2h2"]}]}
    noise_only = {"meta": {}, "files": [
        {"id": "f1", "path": "go.sum", "noise": True, "hunks": [{"id": "f1h1", "noise": None}]},
        {"id": "f2", "path": "a.ts", "noise": False, "hunks": [{"id": "f2h1", "noise": "whitespace"}]}]}
    secs, probs = build_sections(noise_only, {"sections": []})
    assert not probs and [s["kind"] for s in secs] == ["formatting", "generated"], (probs, secs)
    _, probs = build_sections(noise_only, {"sections": [{"title": "A", "why": "w", "how": "h", "items": ["f2"]}]})
    assert any("only has formatting changes" in p for p in probs), probs
    gen2 = {"meta": {}, "files": [{"id": "f1", "path": "api.gen.ts", "noise": True, "hunks": [
        {"id": "f1h1", "noise": None}, {"id": "f1h2", "noise": None}]}]}
    secs, probs = build_sections(gen2, {"sections": [{"title": "A", "why": "w", "how": "h", "items": ["f1h1"]}]})
    assert not probs and secs[-1]["files"] == [{"id": "f1", "hunks": ["f1h2"]}], (probs, secs)
    assert not check_description({"unsupported": [], "missing": [{"what": "x", "hunks": ["f1h2"]}]}, gen2)
    assert len(check_description({"unsupported": "none", "missing": [{"what": "x", "hunks": "f1h2"}],
                                  "issue": [{"ask": "y", "hunks": ["f9h1"]}]}, gen2)) == 3
    import tempfile
    page = os.path.join(tempfile.mkdtemp(), "p.html")
    meta = {"repo": "o/r", "number": 1, "head": "h"}
    render({"meta": dict(meta, body="<!-- template --> </script>"), "files": []}, [], page)
    blob = open(page).read().split('type="application/json">', 1)[1].split("</script>", 1)[0]
    assert "<" not in blob and json.loads(blob)["meta"]["body"] == "<!-- template --> </script>"
    lines = lambda n: [["+", None, k, "x"] for k in range(n)]
    data = {"files": [
        {"id": "f1", "path": "src/store/workspaceChange.ts", "category": "implementation", "noise": False, "hunks": [
            {"id": "f1h1", "noise": None, "lines": lines(30), "usedBy": {"f3h1": ["resetTab"]}},
            {"id": "f1h2", "noise": None, "lines": lines(2)}]},
        {"id": "f2", "path": "e2e/switch.spec.ts", "category": "test", "noise": False, "hunks": [
            {"id": "f2h1", "noise": None, "lines": lines(40)}]},
        {"id": "f3", "path": "src/main.ts", "category": "implementation", "noise": False, "hunks": [
            {"id": "f3h1", "noise": None, "lines": lines(200), "uses": {"resetTab": "f1h1"}},
            {"id": "f3h2", "noise": None, "lines": lines(5)}]},
    ]}
    secs, probs = build_sections(data, {"sections": [
        {"title": "Update workspaceChange", "why": "w [a](f3h1)", "how": "h \u2014 robust", "items": ["f1h1", "f3h2"]},
        {"title": "Tests", "why": "w", "how": "h", "items": ["f2"]},
        {"title": "Wire it", "why": "w [b](f3h1)", "how": "h", "items": ["f3h1"]},
        {"title": "Tidy", "why": "w [c](f1h2)", "how": "h", "items": ["f1h2"]}]})
    assert not probs, probs
    w = "\n".join(lint(data, secs))
    for expect in ("section 1 title", "section 2 is only tests", "section 2 links nothing",
                   "section 1 links [a](f3h1)", "uses '\u2014'", "section 3 holds 200",
                   "section 4 is one 2-line hunk", "f1h1 is in section 1 but connects only to hunks in section 3"):
        assert expect in w, (expect, w)
    sd = {"meta": {}, "stats": {"reviewable": 2500}, "files": [
        {"id": "f1", "path": "src/auth/token.ts", "category": "implementation", "noise": False, "risk": ["auth"], "hunks": [
            {"id": "f1h1", "noise": None, "lines": lines(5), "usedBy": {"f2h1": ["mintToken"]}}]},
        {"id": "f2", "path": "src/menu.ts", "category": "implementation", "noise": False, "risk": [], "hunks": [
            {"id": "f2h1", "noise": None, "lines": lines(5), "uses": {"mintToken": "f1h1"}}]}]}
    g = {"sections": [{"title": "Menu", "why": "w [m](f2)", "how": "h", "items": ["f2"]},
                      {"title": "Token", "why": "w [t](f1)", "how": "h", "items": ["f1"]}],
         "split": {"note": "menu first", "prs": [[1], [2]]}}
    secs, probs = build_sections(sd, g)
    split, sp, sw = check_split(sd, g, secs)
    assert not probs and not sp and split["prs"] == [[1], [2]], (probs, sp)
    assert sw == ["split: PR 1 uses mintToken from section 2, which lands later in PR 2"], sw
    assert check_split(sd, dict(g, split={"prs": [[1]]}), secs)[1], "a split that drops a section must fail"
    sd["files"][0]["hunks"][0]["defines"] = ["switchWorkspace"]
    sd["files"][1]["hunks"][0]["defines"] = ["switchWorkspace"]
    assert "split: switchWorkspace is defined in sections 1, 2, which land in different PRs" in check_split(sd, g, secs)[2]
    w = "\n".join(lint(sd, secs))
    assert "section 2 touches auth code but has no risk note" in w and "suggests no split" in w, w
    g["sections"][1]["risk"] = "mints access tokens"
    secs, _ = build_sections(sd, g)
    sd["_split"] = True
    assert not any("risk note" in x or "no split" in x for x in lint(sd, secs)), lint(sd, secs)
    layers = {7: {"files": [{"id": "f1", "hunks": [{"id": "f1h1"}]}]}}
    one = {"files": [{"id": "f1", "path": "a.ts", "noise": False, "hunks": [{"id": "f1h1", "noise": None}]}]}
    xg = {"sections": [{"title": "A", "why": "w [x](7:f1h1) [y](7:f9)", "how": "h [z](8:f1)", "items": ["f1"]}]}
    _, probs = build_sections(one, xg, layers)
    assert len(probs) == 2 and "#7 has no f9" in probs[0] and "#8 is not a layer" in probs[1], probs
    assert not build_sections(one, xg)[1], "outside a stack, links into other layers go unchecked"
    sp, _ = check_stack_guide({"layers": [], "issues": [{"problem": "see [a](f1h1)"}]}, layers)
    assert any("#7 has no summary" in x for x in sp) and any("names its layer" in x for x in sp), sp
    assert check_stack_guide({"layers": [{"number": 7, "summary": "Adds [the store](7:f1h1)."}]}, layers) == ([], [])
    assert "must be" in check_stack_guide({"layers": [], "issues": [{"layers": "7"}]}, layers)[0][0]
    print("self-test ok")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("workdir", nargs="?")
    p.add_argument("--out")
    p.add_argument("--check", action="store_true")
    p.add_argument("--self-test", action="store_true")
    a = p.parse_args()
    if a.self_test:
        return self_test()
    if not a.workdir:
        p.error("WORKDIR is required")
    if os.path.exists(os.path.join(a.workdir, "stack.json")):
        return stack_main(a)
    data = read_json(os.path.join(a.workdir, "hunks.json"))
    r = load(a.workdir, data)
    fail(r["problems"])
    n = sum(1 for s in r["sections"] if s["kind"] == "guide")
    if a.check:
        warnings = r["warnings"]
        print(f"guide ok: {n} sections, every reviewable hunk placed once"
              + (f"; {len(warnings)} warning(s) to weigh:" if warnings else ""))
        for w in warnings:
            print(f"  {w}")
        return
    out = a.out or os.path.join(a.workdir, "page.html")
    report(out, render(data, r["sections"], out, r["extras"]), f"{n} sections")


def read_json(path):
    with open(path) as fh:
        return json.load(fh)


def load(workdir, data, layers=None):
    """Check one guide against its hunks: sections, split, description check, problems and warnings."""
    problems, desc = [], None
    try:
        guide = read_json(os.path.join(workdir, "guide.json"))
    except (OSError, json.JSONDecodeError) as e:
        return {"problems": [f"guide.json unreadable: {e}"]}
    if data.get("ready"):
        # From the bands as they are now, so a folder collected before they changed renders the same.
        data["ready"]["band"], data["ready"]["tone"] = C.size_band(data["ready"]["lines"])
    sections, problems = build_sections(data, guide, layers)
    split, split_problems, split_warnings = check_split(data, guide, sections) if not problems else (None, [], [])
    problems += split_problems
    data["_split"] = bool(split)
    try:
        desc = read_json(os.path.join(workdir, "description.json"))
    except OSError:
        pass
    except json.JSONDecodeError as e:
        problems.append(f"description.json unreadable: {e}")
    if desc is not None:
        problems += check_description(desc, data)
    warnings = (lint(data, sections) + split_warnings) if not problems else []
    return {"problems": problems, "warnings": warnings, "sections": sections,
            "extras": {"split": split, "descriptionCheck": desc}}


def check_description(desc, data):
    """Problems with description.json's shape. The page reads it as it is, so a wrong type breaks the page."""
    if not isinstance(desc, dict):
        return ["description.json must be an object"]
    out = []
    for key, field in (("unsupported", "claim"), ("missing", "what"), ("issue", "ask")):
        rows = desc.get(key, [])
        if not isinstance(rows, list) or not all(isinstance(x, dict) and isinstance(x.get(field), str) for x in rows):
            out.append(f'description.json: "{key}" must be a list of objects, each with a "{field}" string')
            continue
        for x in rows:
            hs = x.get("hunks", [])
            if not isinstance(hs, list) or not all(isinstance(h, str) and has_id(data, h) for h in hs):
                out.append(f'description.json: "hunks" in "{key}" must be a list of hunk ids from this diff, not {hs!r}')
    return out


def fail(problems):
    if problems:
        print("guide.json has problems:", file=sys.stderr)
        for pr in problems:
            print(f"  {pr}", file=sys.stderr)
        sys.exit(1)


def report(out, size, what):
    print(f"wrote {out} ({size / 1024:.0f} KB, {what})")
    if size > 15 * 1024 * 1024:
        print("warning: over 15 MB, close to the 16 MB artifact limit", file=sys.stderr)


def check_stack_guide(sg, layers):
    """Problems and warnings in the stack check's stack-guide.json."""
    problems, warnings = [], []
    if not isinstance(sg, dict) or not isinstance(sg.get("layers", []), list) or not isinstance(sg.get("issues", []), list) \
            or not all(isinstance(i, dict) and isinstance(i.get("layers", []), list) for i in sg.get("issues", [])):
        return ['stack-guide.json must be {"layers": [...], "issues": [{"layers": [...], ...}]}'], []
    got = {x.get("number"): str(x.get("summary") or "").strip() for x in sg.get("layers") or [] if isinstance(x, dict)}
    for n in layers:
        if not got.get(n):
            problems.append(f"stack-guide.json: layer #{n} has no summary")
        elif len(got[n].split()) > 60:
            warnings.append(f"stack-guide.json: the summary of #{n} runs to {len(got[n].split())} words; keep it to two sentences")
        elif BANNED.search(got[n]):
            warnings.append(f"stack-guide.json: the summary of #{n} uses {BANNED.search(got[n]).group(0)!r}")
    texts = list(got.values()) + [str(i.get(k) or "") for i in sg.get("issues") or [] for k in ("problem", "fix")]
    for text in texts:
        for phrase, target in LINK_RE.findall(text):
            why = bad_xlink(target, layers) if XID_RE.match(target) else "a link here names its layer, as 1014:f3h2"
            if why:
                problems.append(f"stack-guide.json: link [{phrase}]({target}) points at nothing: {why}")
    return problems, warnings


def stack_main(a):
    stack = read_json(os.path.join(a.workdir, "stack.json"))
    layers = {L["number"]: read_json(os.path.join(a.workdir, L["dir"], "hunks.json")) for L in stack["layers"]}
    problems, warnings, payloads, counts, layer_warnings = [], [], [], [], 0
    for L in stack["layers"]:
        n, data = L["number"], layers[L["number"]]
        r = load(os.path.join(a.workdir, L["dir"]), data, layers)
        problems += [f"#{n} {x}" for x in r["problems"]]
        if r["problems"]:
            continue
        # Each layer's own check already weighed these; only their count matters here.
        layer_warnings += len(r["warnings"])
        counts.append(f"#{n} {sum(1 for s in r['sections'] if s['kind'] == 'guide')}")
        payloads.append(dict(data, sections=r["sections"], **r["extras"]))
    sg = None
    try:
        sg = read_json(os.path.join(a.workdir, "stack-guide.json"))
    except OSError:
        pass
    except json.JSONDecodeError as e:
        problems.append(f"stack-guide.json unreadable: {e}")
    if sg is not None:
        p2, w2 = check_stack_guide(sg, layers)
        problems += p2
        warnings += w2
    fail(problems)
    what = f"{len(layers)} layers, sections " + ", ".join(counts)
    if a.check:
        print(f"stack ok: {what}" + ("" if sg else "; no stack-guide.json yet")
              + (f"; {layer_warnings} warning(s) inside layers, weighed by each layer's check" if layer_warnings else "")
              + (f"; {len(warnings)} warning(s) to weigh:" if warnings else ""))
        for w in warnings:
            print(f"  {w}")
        return
    top = stack["layers"][-1]["number"]
    out = a.out or os.path.join(a.workdir, "page.html")
    payload = {"stack": dict(stack, check=sg), "layers": payloads}
    report(out, write_page(payload, f"{stack['repo'].split('/')[-1]}#{top} stack", out), what)


if __name__ == "__main__":
    main()
