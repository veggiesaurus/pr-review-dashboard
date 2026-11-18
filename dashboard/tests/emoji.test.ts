import { describe, expect, test } from "bun:test";
import type { EmojiItem } from "@tiptap/extension-emoji";

import { matchEmoji } from "../src/components/chat/emoji";

const item = (emoji: string, name: string, shortcodes: string[], tags: string[]) => ({ emoji, name, shortcodes, tags }) as EmojiItem;
const all = [
  item("🤔", "thinking", ["thinking", "thinking_face"], ["hmm"]),
  item("💭", "thought balloon", ["thought_balloon"], ["thinking"]),
  item("😀", "grinning", ["grinning"], []),
];

describe("matchEmoji", () => {
  test("a prefix of the name or a shortcode comes before a tag match", () => {
    expect(matchEmoji(all, "think").map(e => e.emoji)).toEqual(["🤔", "💭"]);
  });
  test("one character offers nothing", () => {
    expect(matchEmoji(all, "t")).toEqual([]);
  });
});
