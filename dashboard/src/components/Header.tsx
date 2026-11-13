import { useLayoutEffect, useRef, useState } from "react";
import type { IssueLink, Layer } from "shared/payload";

import { LineCount } from "src/components/guide/LineCount";
import { SectionIndex } from "src/components/guide/SectionIndex";
import { FilterNote, ViewMenu } from "src/components/guide/ViewMenu";
import { IssueRef } from "src/components/links/Issue";
import { Prose } from "src/components/links/Prose";
import { ReadyChips } from "src/components/ready/ReadyChips";
import { LayerNav } from "src/components/stack/LayerNav";
import { useGithub } from "src/queries/live.query";
import { useLayer, useReview } from "src/queries/review.query";
import { progressKeys, useTickedCount } from "src/store/ticks.store";
import { useViewStore } from "src/store/view.store";
import { TABS, type Tab } from "src/utils/anchors";
import { cn } from "src/utils/cn";
import { ago, fullDate } from "src/utils/dates";

const TAB_NAMES: Record<Tab, string> = { overview: "Overview", guide: "Guide", diff: "Diff" };
const https = (url: string | null | undefined): url is string => Boolean(url?.startsWith("https://"));

// An issue the PR links to. The template says in a tooltip whether the PR closes it; here it is said in a word too,
// since a Linear key already opens its own card on hover.
function IssueCrumb({ issue, linear }: { issue: IssueLink; linear: boolean }) {
  const closes = issue.closes !== false;
  const title = closes ? "This PR closes it" : "Linked; this PR doesn't close it";
  return (
    <span className="whitespace-nowrap">
      <span title={title} className="cursor-help">
        {closes ? "closes" : "refs"}
      </span>{" "}
      {linear ? (
        <IssueRef issueKey={issue.ref} />
      ) : https(issue.url) ? (
        <a href={issue.url} target="_blank" rel="noreferrer" title={title} className="hover:text-foreground hover:underline">
          {issue.ref}
        </a>
      ) : (
        <span title={title}>{issue.ref}</span>
      )}
    </span>
  );
}

function Crumbs({ layer }: { layer: Layer }) {
  const { meta } = layer;
  const ref = meta.number ? `${meta.repo}#${meta.number}` : meta.repo;
  const keys = new Set(layer.issueKeys);
  // GitHub's, so a branch with no PR yet has nothing to show here.
  const opened = useGithub(layer.id, layer.capabilities.github).data?.pr?.openedAt;
  return (
    <p className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 pr-24 text-[13px] sm:pr-40 text-muted-foreground max-sm:-order-2">
      {https(meta.url) ? (
        <a href={meta.url} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
          {ref}
        </a>
      ) : (
        <span>{ref}</span>
      )}
      <span className="font-mono text-[12.5px] max-sm:hidden">
        {meta.base} ← {meta.head}
      </span>
      {opened ? (
        <span title={fullDate(opened)}>opened {ago(opened)}</span>
      ) : (
        // Its space is kept while GitHub answers, so the line doesn't wrap and push the page down a moment later.
        layer.capabilities.github && <span className="invisible">opened 00 days ago</span>
      )}
      {meta.issues.map(issue => (
        <IssueCrumb key={issue.ref} issue={issue} linear={keys.has(issue.ref.toUpperCase())} />
      ))}
    </p>
  );
}

function Progress({ layer }: { layer: Layer }) {
  const keys = progressKeys(layer);
  const done = useTickedCount(keys);
  return (
    <span className="whitespace-nowrap">
      {keys.length ? `${done} of ${keys.length} files reviewed` : "Nothing to review beyond formatting and generated files"}
    </span>
  );
}

// The tabs, over one pill that slides to the chosen one. It is placed from the chosen tab's box, so it only shows
// once measured and its first placement doesn't slide in.
function TabList({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const chosen = list.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
      if (chosen) {
        const next = { x: chosen.offsetLeft, width: chosen.offsetWidth };
        setPill(now => (now?.x === next.x && now.width === next.width ? now : next));
      }
    };
    place();
    const watch = new ResizeObserver(place);
    if (list.current) {
      watch.observe(list.current);
    }
    return () => watch.disconnect();
  }, [tab]);

  return (
    <div ref={list} role="tablist" aria-label="Views" className="relative inline-flex rounded-lg border bg-card p-0.5">
      {pill && (
        <span
          aria-hidden
          className="motion-tab-pill absolute inset-y-0.5 left-0 rounded-md bg-muted shadow-xs"
          style={{ translate: `${pill.x}px 0`, width: pill.width }}
        />
      )}
      {TABS.map((name, index) => (
        <button
          key={name}
          type="button"
          role="tab"
          data-tab={name}
          data-label={TAB_NAMES[name]}
          aria-selected={tab === name}
          title={`${TAB_NAMES[name]} (${index + 1})`}
          onClick={() => setTab(name)}
          className={cn(
            // The chosen tab is set bolder, which is wider. Each tab keeps room for its bold form, out of sight, so
            // choosing one doesn't nudge whatever sits to the right of the tabs.
            "relative cursor-pointer rounded-md px-3 py-1 text-sm after:invisible after:block after:h-0 after:overflow-hidden after:font-medium after:content-[attr(data-label)]",
            tab === name ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {TAB_NAMES[name]}
        </button>
      ))}
    </div>
  );
}

export function Header({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const stacked = Boolean(useReview().data?.stack);
  const tab = useViewStore(state => state.tab);
  const setTab = useViewStore(state => state.setTab);
  if (!shown) {
    return null;
  }
  const { meta } = shown;
  const linked = new Set(meta.issues.map(issue => issue.ref.toUpperCase()));
  const chips = shown.issueKeys.filter(key => !linked.has(key));
  return (
    <header className="grid grid-cols-[minmax(0,1fr)] gap-2 border-b pb-3">
      <Crumbs layer={shown} />
      <h1 className="text-balance font-serif text-2xl leading-tight tracking-tight sm:text-3xl">
        <Prose text={meta.title || "Untitled review"} layer={layer} />
      </h1>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
        {meta.author && <span className="text-foreground/80">{meta.author}</span>}
        <LineCount layer={layer} />
        <Progress layer={shown} />
        {chips.map(key => (
          <IssueRef key={key} issueKey={key} chip />
        ))}
        {!stacked && <ReadyChips layer={layer} />}
      </div>
      {/* On a stack the chips keep a row of their own, so a layer with more of them doesn't make the header taller and move the page. */}
      {stacked && <ReadyChips layer={layer} />}
      {/* On a phone the title and chips wrap to a different height for each layer, so the tabs and the layer picker
          sit above them, where they stay put under the thumb. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 max-sm:-order-1">
        <TabList tab={tab} setTab={setTab} />
        <LayerNav />
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
          {tab !== "overview" && <ViewMenu layer={layer} />}
        </div>
      </div>
      {tab !== "overview" && <FilterNote layer={layer} />}
      {tab === "guide" && <SectionIndex layer={layer} />}
    </header>
  );
}
