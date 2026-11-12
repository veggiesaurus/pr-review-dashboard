import { HoverCard as HoverCardPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "src/utils/cn";

export function HoverCard({ openDelay = 200, closeDelay = 120, ...props }: ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" openDelay={openDelay} closeDelay={closeDelay} {...props} />;
}

export function HoverCardTrigger(props: ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />;
}

export function HoverCardContent({
  className,
  align = "start",
  sideOffset = 6,
  collisionPadding = 12,
  ...props
}: ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-[26rem] max-w-[calc(100vw-1.5rem)] origin-(--radix-hover-card-content-transform-origin) rounded-lg border bg-popover p-4 font-sans text-popover-foreground shadow-md outline-hidden data-[state=closed]:animate-out data-[state=open]:animate-in",
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}
