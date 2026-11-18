import type { EmojiItem } from "@tiptap/extension-emoji";

let loaded: EmojiItem[] | null = null;

// The data is big, so it comes in its own chunk the first time it is asked for.
export async function loadEmoji(): Promise<EmojiItem[]> {
  loaded ??= (await import("@tiptap/extension-emoji")).emojis;
  return loaded;
}

export const emojiNow = () => loaded;

// Shortcode or name by prefix first, then tags; needs two characters to say anything.
export function matchEmoji(all: EmojiItem[], query: string, limit = 8): EmojiItem[] {
  const q = query.toLowerCase();
  if (q.length < 2) {
    return [];
  }
  const named = all.filter(e => e.name.startsWith(q) || e.shortcodes.some(s => s.startsWith(q)));
  const tagged = all.filter(e => !named.includes(e) && e.tags.some(t => t.startsWith(q)));
  return [...named, ...tagged].slice(0, limit);
}
