import { Avatar as AvatarPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "src/utils/cn";

export function Avatar({
  className,
  size = "default",
  ...props
}: ComponentProps<typeof AvatarPrimitive.Root> & { size?: "default" | "xs" | "sm" }) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative flex size-8 shrink-0 select-none overflow-hidden rounded-full data-[size=sm]:size-6 data-[size=xs]:size-4.5",
        className,
      )}
      {...props}
    />
  );
}

export function AvatarImage({ className, ...props }: ComponentProps<typeof AvatarPrimitive.Image>) {
  return <AvatarPrimitive.Image data-slot="avatar-image" className={cn("aspect-square size-full object-cover", className)} {...props} />;
}

export function AvatarFallback({ className, ...props }: ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-sm group-data-[size=xs]/avatar:text-[0.5625rem] group-data-[size=sm]/avatar:text-[0.625rem]",
        className,
      )}
      {...props}
    />
  );
}
