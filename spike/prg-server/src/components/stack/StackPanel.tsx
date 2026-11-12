import type { MouseEvent } from "react";
import type { Layer, StackInfo } from "shared/payload";

import { AskClaude } from "src/components/chat/AskClaude";
import { plain } from "src/components/guide/visible";
import { Prose } from "src/components/links/Prose";
import { useChecks, useConflicts } from "src/components/ready/checks";
import { ChipRow, layerChips } from "src/components/ready/ReadyChips";
import { Block, Summary } from "src/components/ui/disclosure";
import { useReview } from "src/queries/review.query";
import { useViewStore } from "src/store/view.store";
import { cn } from "src/utils/cn";

const KIND: Record<string, string> = {
  churn: "Rewritten further up",
  placement: "Belongs in another layer",
  order: "Needs a later layer",
  description: "Description",
  other: "Note",
};

// Summaries sit inside a button, so any link keeps only its phrase.
const hashes = (numbers: number[]) => numbers.map(n => `#${n}`);
const and = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

function Counts({ add, del }: { add: number; del: number }) {
  if (!add && !del) {
    return <span>±0</span>;
  }
  return (
    <span className="whitespace-nowrap">
      {add > 0 && <span className="text-success">+{add}</span>} {del > 0 && <span className="text-danger">−{del}</span>}
    </span>
  );
}

function LayerRow({ layer, stack, current, summary }: { layer: Layer; stack: StackInfo; current: boolean; summary?: string }) {
  const setLayer = useViewStore(state => state.setLayer);
  const checks = useChecks(layer);
  const conflicts = useConflicts(layer);
  const row = stack.layers.find(r => r.number === layer.id);
  const impl = layer.stats.categories.implementation ?? { add: 0, del: 0 };
  // The list stays under the finger: the page keeps its place, and whatever the header above gained or lost in
  // height for the new layer is scrolled away at once. The Overview is drawn afresh for each layer, so the row is
  // found again by its number.
  const choose = (event: MouseEvent<HTMLButtonElement>) => {
    const before = event.currentTarget.getBoundingClientRect().top;
    setLayer(layer.id, true);
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-layer-row="${layer.id}"]`);
      if (row) {
        window.scrollBy({ top: row.getBoundingClientRect().top - before, behavior: "instant" });
      }
    });
  };
  return (
    <li
      className={cn(
        "rounded-lg border bg-card transition-colors hover:border-ring/60",
        current && "border-ring shadow-[inset_3px_0_0_var(--primary)] hover:border-ring",
      )}
    >
      <button
        type="button"
        data-layer-row={layer.id}
        onClick={choose}
        aria-current={current ? "true" : undefined}
        className="group/row grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 px-3 py-2 text-left"
      >
        <span className="font-mono text-muted-foreground text-xs">#{layer.id}</span>
        <span className="font-semibold group-hover/row:text-primary">{layer.meta.title}</span>
        <span className="font-mono text-xs">
          <Counts add={impl.add} del={impl.del} />
        </span>
        <ChipRow small chips={layerChips(layer, row?.needsRebase ?? false, checks, conflicts)} className="col-[2/-1]" />
        {summary && <span className="col-[2/-1] text-[13.5px] text-muted-foreground">{plain(summary)}</span>}
      </button>
    </li>
  );
}

// Every layer of the stack, top first, beside what only shows across the stack.
export function StackPanel() {
  const review = useReview().data;
  const current = useViewStore(state => state.layer);
  const stack = review?.stack;
  if (!review || !stack) {
    return null;
  }
  const at = current ?? review.layers.at(-1)?.id ?? 0;
  const summaries = new Map((stack.check?.layers ?? []).map(x => [x.number, x.summary]));
  const issues = stack.check?.issues ?? [];
  const top = review.layers.at(-1)?.id;
  return (
    <details id="stack" open className="motion-expand">
      <Summary>
        <h2 className="font-serif text-xl">Stack of {review.layers.length} PRs</h2>
      </Summary>
      <div className="mt-3 grid gap-3">
        <div className={cn("grid items-start gap-3", issues.length > 0 && "min-[861px]:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]")}>
          <ol className="grid gap-1.5" aria-label="Layers, top first">
            {[...review.layers].reverse().map(item => (
              <LayerRow key={item.id} layer={item} stack={stack} current={item.id === at} summary={summaries.get(item.id)} />
            ))}
            <li className="rounded-lg border border-dashed px-3 py-1.5 font-mono text-muted-foreground text-xs">
              {review.layers[0]?.meta.base}
            </li>
          </ol>
          {issues.length > 0 && (
            <Block title="Across the stack">
              {issues.map((issue, index) => {
                // The problem and the fix name their PRs as they go; only a layer they leave out is listed.
                const said = `${issue.problem} ${issue.fix ?? ""}`;
                const unsaid = hashes((issue.layers ?? []).filter(number => !said.includes(`#${number}`)));
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: issues have no id and keep their order
                  <li key={index}>
                    <b className="font-semibold">{KIND[issue.kind] ?? KIND.other}:</b>{" "}
                    {unsaid.length > 0 && <span className="text-muted-foreground">{unsaid.join(", ")} </span>}
                    <Prose text={issue.problem} layer={at} />
                    {issue.fix && (
                      <span className="text-muted-foreground">
                        {" "}
                        <Prose text={issue.fix} layer={at} />
                      </span>
                    )}
                    <AskClaude anchor={{ kind: "stackIssue", index }} className="ml-1 align-middle" />
                  </li>
                );
              })}
            </Block>
          )}
        </div>
        {stack.forks.length > 0 && (
          <p className="text-[13.5px] text-muted-foreground">
            The stack forks above #{top} into {and(hashes(stack.forks))}; build the page from the top PR of a branch to include it.
          </p>
        )}
        {!stack.check &&
          stack.churn.map(group => (
            <p key={`${group.path}:${group.fromLayer}:${group.toLayer}`} className="text-[13.5px] text-muted-foreground">
              #{group.toLayer} removes {group.lines === 1 ? "a line" : `${group.lines} lines`} of{" "}
              <code className="font-mono text-foreground text-xs">{group.path}</code> that #{group.fromLayer} adds.
            </p>
          ))}
      </div>
    </details>
  );
}
