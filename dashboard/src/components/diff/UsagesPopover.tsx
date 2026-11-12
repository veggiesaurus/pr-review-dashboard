import { Popover } from "radix-ui";
import { useMemo } from "react";
import type { UsagesResponse } from "shared/live";

import { useUsages } from "src/queries/live.query";
import { useLayer } from "src/queries/review.query";
import { useViewStore } from "src/store/view.store";

export type UsageTarget = { word: string; range: Range; rect: DOMRect };

// A search's matches. One on a line this layer's diff shows can jump there; the others are only listed.
export function UsageMatches({ layer, data, onJump }: { layer: number; data: UsagesResponse; onJump: () => void }) {
  const shown = useLayer(layer);
  const goTo = useViewStore(state => state.goTo);
  const inDiff = (path: string, line: number) => {
    const file = shown?.files.find(f => f.path === path);
    return file?.hunks.some(h => h.lines.some(row => row[0] !== "-" && row[2] === line)) ? file.id : null;
  };
  return (
    <ul className="mt-2 max-h-72 overflow-y-auto rounded-md border bg-background font-mono text-xs">
      {data.matches.map(match => {
        const file = inDiff(match.path, match.line);
        const where = `${match.path}:${match.line}`;
        return (
          <li key={where} className="border-b px-2.5 py-1.5 [overflow-wrap:anywhere] last:border-b-0">
            {file ? (
              <button
                type="button"
                onClick={() => {
                  onJump();
                  goTo(layer, `${file}:R${match.line}`);
                }}
                className="cursor-pointer text-primary hover:underline"
                title="In this diff: go there"
              >
                {where}
              </button>
            ) : (
              <span className="text-muted-foreground">{where}</span>
            )}
            <span className="mt-0.5 block whitespace-pre-wrap text-foreground/80 [overflow-wrap:anywhere]">{match.text.trim()}</span>
          </li>
        );
      })}
      {data.more && <li className="px-2.5 py-1.5 font-sans text-muted-foreground">There are more than these.</li>}
    </ul>
  );
}

// The lines that use a name from the diff, searched at the layer's head commit, opened by clicking the name.
export function UsagesPopover({ layer, target, onClose }: { layer: number; target: UsageTarget; onClose: () => void }) {
  const { data, isPending, error } = useUsages(layer, target.word);
  const anchor = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => {
          const rect = target.range.getBoundingClientRect();
          return rect.width ? rect : target.rect;
        },
      },
    }),
    [target],
  );
  return (
    <Popover.Root open onOpenChange={open => !open && onClose()}>
      <Popover.Anchor virtualRef={anchor} />
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="motion-pop z-50 w-[30rem] max-w-[calc(100vw-1.5rem)] rounded-lg border bg-popover p-3 font-sans text-popover-foreground shadow-md outline-hidden"
        >
          <p className="text-sm">
            Lines that use <code className="font-mono text-[13px]">{target.word}</code> on this branch
          </p>
          {isPending && <p className="motion-loading mt-2 text-muted-foreground text-sm">Searching…</p>}
          {(error || data?.error) && <p className="mt-2 text-danger text-sm">{data?.error ?? "The search failed."}</p>}
          {data && !data.error && data.matches.length === 0 && <p className="mt-2 text-muted-foreground text-sm">Nothing else uses it.</p>}
          {data && data.matches.length > 0 && <UsageMatches layer={layer} data={data} onJump={onClose} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
