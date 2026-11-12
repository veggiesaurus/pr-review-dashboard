import { useMemo } from "react";

import { RefLink } from "src/components/links/RefLink";
import { useLayer } from "src/queries/review.query";
import { useViewStore } from "src/store/view.store";
import { parseInline } from "src/utils/inline";

export const LINK = "font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary";
const CODE = "rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.875em] [overflow-wrap:anywhere]";

// Inline text from the guide, the description check, commit messages or Claude: `code`, links to hunks in this layer
// or another (f3h2, 1014:f3h2), https links, and Linear and GitHub references with previews. Never HTML. section is
// the guide section the text belongs to, so a link to a file split across sections lands on this section's card.
export function Prose({ text, layer, section }: { text: string; layer: number; section?: number }) {
  const repo = useLayer(layer)?.meta.repo || null;
  const goTo = useViewStore(state => state.goTo);
  const parts = useMemo(() => parseInline(text, repo), [text, repo]);
  return parts.map((part, index) => {
    // biome-ignore-start lint/suspicious/noArrayIndexKey: the parts of one string never reorder
    switch (part.type) {
      case "code":
        return (
          <code key={index} className={CODE}>
            {part.text}
          </code>
        );
      case "anchor":
        return (
          <a
            key={index}
            href={`#${part.id}`}
            className={LINK}
            onClick={event => {
              event.preventDefault();
              goTo(layer, part.id, section);
            }}
          >
            {part.text}
          </a>
        );
      case "link":
        return <RefLink key={index} reference={part.ref} text={part.text} href={part.href} repo={repo} className={LINK} />;
      case "ref":
        return <RefLink key={index} reference={part.ref} text={part.text} href={null} repo={repo} />;
      default:
        return <span key={index}>{part.text}</span>;
    }
    // biome-ignore-end lint/suspicious/noArrayIndexKey: the parts of one string never reorder
  });
}
