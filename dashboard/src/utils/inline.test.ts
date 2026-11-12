import { expect, test } from "bun:test";

import { findRefs } from "shared/refs";

import { parseInline } from "./inline";

const REPO = "acme/shop";

test("splits guide prose into text, code, file anchors and web links", () => {
  expect(
    parseInline("Post links now [start with /blog](f3), see `slug()` in [the hunk](f4h2) and [the docs](https://example.com/a)."),
  ).toEqual([
    { type: "text", text: "Post links now " },
    { type: "anchor", text: "start with /blog", id: "f3" },
    { type: "text", text: ", see " },
    { type: "code", text: "slug()" },
    { type: "text", text: " in " },
    { type: "anchor", text: "the hunk", id: "f4h2" },
    { type: "text", text: " and " },
    { type: "link", text: "the docs", href: "https://example.com/a", ref: null },
    { type: "text", text: "." },
  ]);
});

test("a link to anywhere but https stays as the text that was written", () => {
  expect(parseInline("[click](javascript:alert(1)) and [x](../secrets) and [y](http://example.com) and http://example.com/a")).toEqual([
    { type: "text", text: "[click](javascript:alert(1)) and [x](../secrets) and [y](http://example.com) and http://example.com/a" },
  ]);
});

test("a link into another layer of a stack is an anchor too", () => {
  expect(parseInline("see [the card](1013:f42h1)")).toEqual([
    { type: "text", text: "see " },
    { type: "anchor", text: "the card", id: "1013:f42h1" },
  ]);
});

test("Linear keys are references, but not inside code, not lower case mid-sentence and not inside a longer word", () => {
  expect(parseInline("FRO-566 tidies `ABC-1` up, unlike xFRO-566, fro-566 or ABC-1x (see ABC-1).", REPO)).toEqual([
    { type: "ref", text: "FRO-566", ref: { kind: "linear", key: "FRO-566" } },
    { type: "text", text: " tidies " },
    { type: "code", text: "ABC-1" },
    { type: "text", text: " up, unlike xFRO-566, fro-566 or ABC-1x (see " },
    { type: "ref", text: "ABC-1", ref: { kind: "linear", key: "ABC-1" } },
    { type: "text", text: ")." },
  ]);
});

test("a lower-case key leading the text is a reference, as Linear links it in a title", () => {
  expect(parseInline("bac-1555: adds the thing")[0]).toEqual({ type: "ref", text: "bac-1555", ref: { kind: "linear", key: "BAC-1555" } });
  expect(parseInline("see bac-1555")).toEqual([{ type: "text", text: "see bac-1555" }]);
});

test("GitHub references: #12 in the review's repository, owner/repo#12 elsewhere, and never an entity or a fragment", () => {
  expect(parseInline("Follows #12 and other/lib#7, not &#39; or page#3 or ##4x.", REPO)).toEqual([
    { type: "text", text: "Follows " },
    { type: "ref", text: "#12", ref: { kind: "github", repo: REPO, number: 12 } },
    { type: "text", text: " and " },
    { type: "ref", text: "other/lib#7", ref: { kind: "github", repo: "other/lib", number: 7 } },
    { type: "text", text: ", not &#39; or page#3 or ##4x." },
  ]);
  expect(parseInline("Follows #12", null)).toEqual([{ type: "text", text: "Follows #12" }]);
});

test("bare GitHub and Linear URLs become references written short, without the punctuation after them", () => {
  expect(
    parseInline(
      "See https://github.com/acme/shop/pull/12/files, https://github.com/other/lib/commit/0123abcd and https://linear.app/acme/issue/FRO-9/slug.",
      REPO,
    ),
  ).toEqual([
    { type: "text", text: "See " },
    {
      type: "link",
      text: "#12",
      href: "https://github.com/acme/shop/pull/12/files",
      ref: { kind: "github", repo: "acme/shop", number: 12 },
    },
    { type: "text", text: ", " },
    {
      type: "link",
      text: "other/lib@0123abc",
      href: "https://github.com/other/lib/commit/0123abcd",
      ref: { kind: "commit", repo: "other/lib", sha: "0123abcd" },
    },
    { type: "text", text: " and " },
    { type: "link", text: "FRO-9", href: "https://linear.app/acme/issue/FRO-9/slug", ref: { kind: "linear", key: "FRO-9" } },
    { type: "text", text: "." },
  ]);
});

test("a labelled link keeps its label and still knows what it points at", () => {
  expect(parseInline("[the fix](https://github.com/acme/shop/pull/12/commits/abcdef1)", REPO)).toEqual([
    {
      type: "link",
      text: "the fix",
      href: "https://github.com/acme/shop/pull/12/commits/abcdef1",
      ref: { kind: "commit", repo: "acme/shop", sha: "abcdef1" },
    },
  ]);
});

test("findRefs lists every reference in markdown, whether bare, linked or a URL", () => {
  const body =
    "Fixes FRO-1 and #3.\n\n- [x] see [#4](https://github.com/acme/shop/issues/4)\n- https://github.com/acme/shop/commit/abcdef1";
  expect(findRefs(body, REPO)).toEqual([
    { kind: "linear", key: "FRO-1" },
    { kind: "github", repo: REPO, number: 3 },
    { kind: "github", repo: REPO, number: 4 },
    { kind: "commit", repo: REPO, sha: "abcdef1" },
  ]);
});
