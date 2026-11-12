import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "src/utils/cn";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs whitespace-nowrap [&_svg]:size-3", {
  variants: {
    tone: {
      neutral: "bg-muted text-foreground/75",
      outline: "border text-foreground/75",
      primary: "bg-primary/12 text-primary",
      success: "bg-success/12 text-success",
      warning: "bg-warning/14 text-warning",
      danger: "bg-danger/12 text-danger",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export type Tone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({ className, tone, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
