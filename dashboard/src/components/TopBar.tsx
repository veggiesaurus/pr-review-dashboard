import { useRef } from "react";
import type { Layer } from "shared/payload";

import { ClaudeButton } from "src/components/chat/ClaudePanel";
import { RebuildButton } from "src/components/chat/RebuildButton";
import { KeysHelp } from "src/components/guide/Keyboard";
import { ViewMenu } from "src/components/guide/ViewMenu";
import { Prose } from "src/components/links/Prose";
import { Avatars } from "src/components/presence/Avatars";
import { ReadyPill } from "src/components/ready/ReadyChips";
import { ShutdownButton } from "src/components/ShutdownButton";
import { ShareButton } from "src/components/share/ShareButton";
import { LayerNav } from "src/components/stack/LayerNav";
import { ThemeButton } from "src/components/ThemeButton";
import { Segmented } from "src/components/ui/segmented";
import { useIsOwner } from "src/queries/me.query";
import { usePresenceList } from "src/queries/presence.query";
import { useLayer, useReview } from "src/queries/review.query";
import { progressFiles, useReviewedCount } from "src/store/ticks.store";
import { useViewStore } from "src/store/view.store";
import type { Tab } from "src/utils/anchors";

function Progress({ layer }: { layer: Layer }) {
  const files = progressFiles(layer);
  const done = useReviewedCount(files);
  if (!files.length) {
    return null;
  }
  return (
    <span className="shrink-0 whitespace-nowrap text-muted-foreground text-sm max-xl:hidden" title="Files reviewed">
      {done} of {files.length} files
    </span>
  );
}

export function PageActions({ owner }: { owner: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {owner && <ShareButton />}
      {owner && <RebuildButton />}
      <KeysHelp />
      <ThemeButton />
      {owner && <ShutdownButton />}
    </span>
  );
}

// The page's one bar, always in view: which PR, its title cut to fit, where you are, what wants a look and how far
// through you are. The PR's other facts are on the Overview.
export function TopBar({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const stacked = Boolean(useReview().data?.stack);
  const tab = useViewStore(state => state.tab);
  const setTab = useViewStore(state => state.setTab);
  const owner = useIsOwner();
  const others = usePresenceList();
  // Changes opens by section or by file, whichever was last used.
  const changes = useRef<Tab>("guide");
  if (tab !== "overview") {
    changes.current = tab;
  }
  if (!shown) {
    return null;
  }
  const { meta } = shown;
  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="flex h-12 items-center gap-3 px-4 min-[80rem]:px-6">
        {stacked ? (
          <LayerNav />
        ) : meta.url?.startsWith("https://") ? (
          <a
            href={meta.url}
            target="_blank"
            rel="noreferrer"
            title={`${meta.repo}#${meta.number}`}
            className="shrink-0 font-mono text-muted-foreground text-xs hover:text-foreground hover:underline"
          >
            #{meta.number}
          </a>
        ) : null}
        {!stacked && (
          <h1 className="min-w-32 flex-1 truncate font-serif text-base" title={meta.title}>
            <Prose text={meta.title || "Untitled review"} layer={layer} />
          </h1>
        )}
        {stacked && (
          <>
            <h1 className="sr-only">{meta.title}</h1>
            <span className="flex-1" />
          </>
        )}
        <Segmented
          tabs
          label="Views"
          value={tab === "overview" ? "overview" : "changes"}
          onChange={value => setTab(value === "overview" ? "overview" : changes.current)}
          segments={[
            { value: "overview", label: "Overview", title: "Overview (1)" },
            { value: "changes", label: "Changes", title: "Changes (2 by section, 3 by file)" },
          ]}
        />
        <ReadyPill layer={layer} />
        <Progress layer={shown} />
        {tab !== "overview" && (
          <span className="flex shrink-0 items-center gap-3 max-xl:hidden">
            <ViewMenu layer={layer} />
          </span>
        )}
        <Avatars people={others} size="sm" />
        <ClaudeButton />
        <PageActions owner={owner} />
      </div>
    </header>
  );
}
