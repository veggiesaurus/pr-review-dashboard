import { type InlinePart, tokenize } from "shared/refs";

export type { InlinePart };

// The guide's prose, Claude's replies and the rest of the inline text: see tokenize. repo is what a bare #12 means.
export const parseInline = (source: string, repo: string | null = null): InlinePart[] => tokenize(source, repo);
