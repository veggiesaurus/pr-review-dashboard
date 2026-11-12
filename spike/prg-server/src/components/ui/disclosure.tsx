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

export const BLOCK = "motion-expand rounded-lg border bg-card px-3 py-2";
export const BLOCK_TITLE = "font-semibold text-[13.5px]";
export const BLOCK_LIST = "mt-1.5 mb-0.5 grid list-disc gap-1.5 pl-5 text-[13.5px] [overflow-wrap:anywhere]";

// A titled card that folds, holding a list of findings. Each item reads the same way: a bold label and a colon,
// the text, anything secondary muted, then its Ask Claude button.
export function Block({ title, note, open = true, children }: { title: string; note?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className={BLOCK}>
      <Summary className={BLOCK_TITLE}>{title}</Summary>
      {note}
      <ul className={BLOCK_LIST}>{children}</ul>
    </details>
  );
}
