import { ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "src/utils/cn";

// The one way a fold is drawn: a chevron that turns as its details opens, in place of the browser's own marker.
export function Summary({ className, children, ...props }: ComponentProps<"summary">) {
  return (
    <summary className={cn("flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden", className)} {...props}>
      <ChevronRight
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground transition-transform [details[open]>summary>&]:rotate-90"
      />
      {children}
    </summary>
  );
}

export const BLOCK = "motion-expand px-3 py-2.5";
// A block on its own is a card. Several in one list are its rows, where a card each would give them all the same weight.
export const CARD = "rounded-lg border bg-card";
export const BLOCKS = `divide-y ${CARD} empty:hidden`;
// How much a block needs the reader: something is wrong, something to look at, settled, or only there to read.
export type BlockTone = "bad" | "warn" | "good" | "quiet";
const DOT: Record<BlockTone, string> = { bad: "bg-danger", warn: "bg-warning", good: "bg-success", quiet: "bg-muted-foreground/35" };
const TONE_WORDS: Record<BlockTone, string> = { bad: "Something is wrong: ", warn: "To look at: ", good: "Settled: ", quiet: "" };

// The mark before a block's title. Its words are for a screen reader, which the colour doesn't reach.
export function ToneDot({ tone }: { tone: BlockTone }) {
  return (
    <>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
      {TONE_WORDS[tone] && <span className="sr-only">{TONE_WORDS[tone]}</span>}
    </>
  );
}
export const BLOCK_TITLE = "font-semibold text-[13.5px]";
export const BLOCK_LIST = "mt-1.5 mb-0.5 grid list-disc gap-1.5 pl-5 text-[13.5px] [overflow-wrap:anywhere]";

// A titled block that folds, holding a list of findings. Each item reads the same way: a bold label and a colon,
// the text, anything secondary muted, then its Ask Claude button. tone puts its mark before the title.
export function Block({
  title,
  note,
  open = true,
  tone,
  className,
  children,
}: {
  title: string;
  note?: ReactNode;
  open?: boolean;
  tone?: BlockTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details open={open} data-tone={tone} className={cn(BLOCK, className)}>
      <Summary className={BLOCK_TITLE}>
        {tone && <ToneDot tone={tone} />}
        {title}
      </Summary>
      {note}
      <ul className={BLOCK_LIST}>{children}</ul>
    </details>
  );
}
