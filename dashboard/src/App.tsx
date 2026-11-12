import { useEffect, useState } from "react";

import { ChatDock } from "src/components/chat/ChatDock";
import { DiffTab } from "src/components/guide/DiffTab";
import { Guide } from "src/components/guide/Guide";
import { JumpTo } from "src/components/guide/JumpTo";
import { KeysHelp, useKeyboard } from "src/components/guide/Keyboard";
import { RenderError } from "src/components/guide/RenderError";
import { SectionRail } from "src/components/guide/SectionRail";
import { Header } from "src/components/Header";
import { Overview } from "src/components/overview/Overview";
import { ThemeButton } from "src/components/ThemeButton";
import { useHashSync } from "src/hooks/useHashSync";
import { useLiveSocket } from "src/hooks/useLiveSocket";
import { useLayer, useReview } from "src/queries/review.query";
import { PAGE_COLUMN, useViewStore } from "src/store/view.store";
import { cn } from "src/utils/cn";
import { pageTitle } from "src/utils/payload";

// Whether the last change was to another layer. A layer swaps in place, with nothing moving, so the stack list and
// the header stay still under the pointer; only a change of tab gets the panel's entrance.
function useLayerSwapped(layer: number | null, tab: string) {
  const [last, setLast] = useState({ layer, tab, swapped: false });
  if (last.layer !== layer || last.tab !== tab) {
    const swapped = last.layer !== null && last.layer !== layer;
    setLast({ layer, tab, swapped });
    return swapped;
  }
  return last.swapped;
}

export function App() {
  const connected = useLiveSocket();
  const { data, isPending, isError } = useReview();
  useHashSync(data);
  useKeyboard();
  const layer = useViewStore(state => state.layer);
  const tab = useViewStore(state => state.tab);
  const shown = useLayer(layer);
  const swapped = useLayerSwapped(layer, tab);

  useEffect(() => {
    if (data && shown) {
      document.title = pageTitle(data, shown);
    }
  }, [data, shown]);

  return (
    <div className="relative min-h-screen">
      {/* On the column's right edge, level with the header's first line. */}
      <div className={cn("pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-end", PAGE_COLUMN)}>
        <div className="pointer-events-auto flex items-center gap-1">
          <KeysHelp />
          <ThemeButton />
        </div>
      </div>
      {shown && tab === "guide" && <SectionRail layer={shown.id} />}
      <main className={cn("pt-3 pb-28", PAGE_COLUMN)}>
        {isPending && <p className="text-muted-foreground">Loading the review…</p>}
        {isError && <p className="text-danger">The server didn't answer. Open the link your Claude session gave you again.</p>}
        {shown && (
          <>
            <Header layer={shown.id} />
            <RenderError />
            <div key={`${shown.id}:${tab}`} className={swapped ? undefined : "motion-panel"}>
              {tab === "overview" && <Overview layer={shown.id} />}
              {tab === "guide" && <Guide layer={shown.id} />}
              {tab === "diff" && <DiffTab layer={shown.id} />}
            </div>
          </>
        )}
      </main>
      {shown && <JumpTo layer={shown.id} />}
      <ChatDock connected={connected} />
    </div>
  );
}
