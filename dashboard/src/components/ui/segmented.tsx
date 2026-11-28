import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { cn } from "src/utils/cn";

export type Segment<T extends string> = { value: T; label: ReactNode; title?: string; name?: string };

// The page's one switch between views. The pill is placed from the chosen segment's box, so it shows once measured
// and doesn't slide in. tabs makes the segments tabs; otherwise they are pressed buttons.
export function Segmented<T extends string>({
  value,
  segments,
  onChange,
  label,
  tabs = false,
  className,
}: {
  value: T | null;
  segments: Segment<T>[];
  onChange: (value: T) => void;
  label: string;
  tabs?: boolean;
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const chosen = value === null ? null : list.current?.querySelector<HTMLElement>(`[data-segment="${value}"]`);
      const next = chosen ? { x: chosen.offsetLeft, width: chosen.offsetWidth } : null;
      setPill(now => (now?.x === next?.x && now?.width === next?.width ? now : next));
    };
    place();
    const watch = new ResizeObserver(place);
    if (list.current) {
      watch.observe(list.current);
    }
    return () => watch.disconnect();
  }, [value]);

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is tablist or group, which both take a label
    <div
      ref={list}
      role={tabs ? "tablist" : "group"}
      aria-label={label}
      className={cn("relative inline-flex shrink-0 rounded-lg border bg-card p-0.5", className)}
    >
      {pill && (
        <span
          aria-hidden
          className="motion-tab-pill absolute inset-y-0.5 left-0 rounded-md bg-muted shadow-xs"
          style={{ translate: `${pill.x}px 0`, width: pill.width }}
        />
      )}
      {segments.map(segment => {
        const on = segment.value === value;
        return (
          // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-selected is only set when the role is tab
          <button
            key={segment.value}
            type="button"
            role={tabs ? "tab" : undefined}
            aria-selected={tabs ? on : undefined}
            aria-pressed={tabs ? undefined : on}
            aria-label={segment.name}
            data-segment={segment.value}
            data-label={typeof segment.label === "string" ? segment.label : undefined}
            title={segment.title}
            onClick={() => onChange(segment.value)}
            className={cn(
              // Each keeps room for its bold form out of sight, so choosing one doesn't nudge what sits beside the switch.
              "relative cursor-pointer whitespace-nowrap rounded-md px-2.5 py-1 text-sm pointer-coarse:min-h-11 pointer-coarse:px-3.5",
              "after:invisible after:block after:h-0 after:overflow-hidden after:font-medium after:content-[attr(data-label)]",
              on ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
