import { expect, test } from "bun:test";

import { summaryParts } from "../shared/summary";

// The guide worker writes the summary, so its layout is input we don't control; each part here is one a thread can be about.
test("a summary splits into its paragraphs and list items, an indented line carrying on the item above", () => {
  const text = "Moves posts\nto /blog.\n\nTo check:\n- Open a post\n  from the index\n- Open an old link\n\nThat's all.";
  expect(summaryParts(text)).toEqual([
    { text: "Moves posts to /blog.", item: false },
    { text: "To check:", item: false },
    { text: "Open a post from the index", item: true },
    { text: "Open an old link", item: true },
    { text: "That's all.", item: false },
  ]);
});
