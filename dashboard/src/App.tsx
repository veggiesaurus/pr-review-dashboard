import { useEffect, useMemo, useState } from "react";

import { ClaudePanel } from "src/components/chat/ClaudePanel";
import { useChatStore } from "src/components/chat/chat.store";
import { MentionCard } from "src/components/chat/MentionCard";
import { useThreads } from "src/components/chat/useThreads";
import { usePhone, useWide } from "src/components/diff/hooks";
import { DiffTab } from "src/components/guide/DiffTab";
import { Guide } from "src/components/guide/Guide";
import { JumpTo } from "src/components/guide/JumpTo";
import { useKeyboard } from "src/components/guide/Keyboard";
import { Outline } from "src/components/guide/Outline";
import { RenderError } from "src/components/guide/RenderError";
import { FilterNote, ViewMenu } from "src/components/guide/ViewMenu";
import { shownSections } from "src/components/guide/visible";
import { Overview } from "src/components/overview/Overview";
import { PhoneShell } from "src/components/phone/PhoneShell";
import { SignIn } from "src/components/share/SignIn";
import { TopBar } from "src/components/TopBar";
import { Segmented } from "src/components/ui/segmented";
import { useCurrentSection } from "src/hooks/useCurrentSection";
import { useHashSync } from "src/hooks/useHashSync";
import { useLiveSocket } from "src/hooks/useLiveSocket";
import { usePresence } from "src/hooks/usePresence";
import { errorText } from "src/queries/messages.mutation";
import { useLayer, useReview } from "src/queries/review.query";
import { useViewStore } from "src/store/view.store";
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

// The columns of the page: the outline beside the Changes view on a wide window, and the Claude panel beside both
// once there is room for it (below that it slides over the page).
function columns(changes: boolean, panel: boolean) {
  if (changes) {
    return panel
      ? "min-[861px]:grid-cols-[17rem_minmax(0,1fr)] min-[1280px]:grid-cols-[17rem_minmax(0,1fr)_24rem] min-[1600px]:grid-cols-[21rem_minmax(0,1fr)_27rem]"
      : "min-[861px]:grid-cols-[17rem_minmax(0,1fr)] min-[1600px]:grid-cols-[21rem_minmax(0,1fr)]";
  }
  return panel ? "min-[1280px]:grid-cols-[minmax(0,1fr)_26rem] min-[1600px]:grid-cols-[minmax(0,1fr)_27rem]" : "";
}

export function App() {
  const connected = useLiveSocket();
  const { data, isPending, isError, error } = useReview();
  const phone = usePhone();
  const wide = useWide();
  useHashSync(data);
  useKeyboard();
  const layer = useViewStore(state => state.layer);
  const tab = useViewStore(state => state.tab);
  const setTab = useViewStore(state => state.setTab);
  const shown = useLayer(layer);
  const swapped = useLayerSwapped(layer, tab);
  const show = useViewStore(state => state.show);
  const formatting = useViewStore(state => state.formatting);
  const sections = useMemo(() => (shown ? shownSections(shown, show, formatting) : []), [shown, show, formatting]);
  const current = useCurrentSection(sections);
  usePresence(connected, layer, tab, current);
  const setConnected = useChatStore(state => state.setConnected);
  useEffect(() => setConnected(connected), [connected, setConnected]);
  const panel = useChatStore(state => state.chatOpen);

  // The tab says how many threads wait on its reader, so a page left open needn't be looked at to know.
  const waiting = useThreads().yours.length;
  useEffect(() => {
    if (data && shown) {
      document.title = `${waiting ? `(${waiting}) ` : ""}${pageTitle(data, shown)}`;
    }
  }, [data, shown, waiting]);

  // A guest who has opened the share link but not signed in is told so by every call.
  if (isError && errorText(error, "") === "sign in") {
    return <SignIn />;
  }
  if (isPending || isError || !shown) {
    return (
      <main className="p-6">
        {isPending && <p className="text-muted-foreground">Loading the review…</p>}
        {isError && <p className="text-danger">The server didn't answer. Open the link your Claude session gave you again.</p>}
      </main>
    );
  }
  if (phone) {
    return (
      <>
        <PhoneShell layer={shown.id} />
        <JumpTo layer={shown.id} />
        <MentionCard />
      </>
    );
  }

  const changes = tab !== "overview";
  return (
    <div className="min-h-screen">
      <TopBar layer={shown.id} />
      <div className={cn("grid", columns(changes, panel))}>
        {changes && wide && <Outline layer={shown.id} current={current} />}
        <main className="min-w-0 px-4 pt-3 pb-16 min-[80rem]:px-6">
          {/* The view controls fold out of the bar below 1280px; the outline's switch, below 860px. */}
          {changes && (
            <div className="flex flex-wrap items-center gap-3 pb-2 xl:hidden">
              {!wide && shown.sections.length > 0 && (
                <Segmented
                  label="Show the changes"
                  value={tab}
                  onChange={setTab}
                  segments={[
                    { value: "guide", label: "Sections" },
                    { value: "diff", label: "Files" },
                  ]}
                />
              )}
              <ViewMenu layer={shown.id} />
            </div>
          )}
          {changes && <FilterNote layer={shown.id} />}
          <RenderError />
          <div key={`${shown.id}:${tab}`} className={swapped ? undefined : "motion-panel"}>
            {tab === "overview" && <Overview layer={shown.id} />}
            {tab === "guide" && <Guide layer={shown.id} />}
            {tab === "diff" && <DiffTab layer={shown.id} />}
          </div>
        </main>
        <ClaudePanel />
      </div>
      <JumpTo layer={shown.id} />
      <MentionCard />
    </div>
  );
}
