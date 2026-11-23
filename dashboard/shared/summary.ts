// A summary's parts, as the page shows them and a thread is about one: each paragraph, and each item of a list.
// Lines starting "- " are items, and an indented line carries on the item above it; other lines run into paragraphs.
export type SummaryPart = { text: string; item: boolean };

export function summaryParts(text: string): SummaryPart[] {
  const parts: SummaryPart[] = [];
  let paragraph: string[] = [];
  const close = () => {
    if (paragraph.length) {
      parts.push({ text: paragraph.join(" "), item: false });
      paragraph = [];
    }
  };
  for (const line of text.split("\n")) {
    const words = line.trim();
    const last = parts.at(-1);
    if (!words) {
      close();
    } else if (words.startsWith("- ")) {
      close();
      parts.push({ text: words.slice(2).trim(), item: true });
    } else if (last?.item && !paragraph.length && /^\s/.test(line)) {
      last.text = `${last.text} ${words}`;
    } else {
      paragraph.push(words);
    }
  }
  close();
  return parts;
}
