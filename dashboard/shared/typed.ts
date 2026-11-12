const ENTITIES: Record<string, string> = { lt: "<", gt: ">", quot: '"', "#39": "'", amp: "&" };

// What the user typed, for whoever reads the raw text: the chat editor's markdown escapes and entities undone, except
// in code, where it adds none.
export function typedText(markdown: string) {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/\\([\\`*_[\]~#>+\-.!|{}()])/g, "$1").replace(/&(lt|gt|quot|#39|amp);/g, (_, name: string) => ENTITIES[name] ?? ""),
    )
    .join("");
}
