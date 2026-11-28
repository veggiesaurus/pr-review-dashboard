import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { ClaudePanel } from "src/components/chat/ClaudePanel";
import { useChatStore } from "src/components/chat/chat.store";
import { RebuildButton } from "src/components/chat/RebuildButton";
import { useThreads } from "src/components/chat/useThreads";
import { FileCard } from "src/components/diff/FileCard";
import { FileList } from "src/components/guide/DiffTab";
import { diagramHomes, SectionText } from "src/components/guide/Guide";
import { pad2, plural, shownSections } from "src/components/guide/visible";
import { Overview } from "src/components/overview/Overview";
import { ReadyPill } from "src/components/ready/ReadyChips";
import { ShutdownButton } from "src/components/ShutdownButton";
import { ShareButton } from "src/components/share/ShareButton";
import { LayerNav } from "src/components/stack/LayerNav";
import { ThemeButton } from "src/components/ThemeButton";
import { Button } from "src/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "src/components/ui/popover";
import { DiagramCard } from "src/components/visualize/DiagramCard";
import { useIsOwner } from "src/queries/me.query";
import { useLayer, useReview } from "src/queries/review.query";
import { useSetTicks, useTicks } from "src/queries/ticks.query";
import { sectionTickKeys, tickKey } from "src/store/ticks.store";
import { useViewStore } from "src/store/view.store";
import { parseTarget, sectionElementId } from "src/utils/anchors";
import { cn } from "src/utils/cn";
import { indexLayer } from "src/utils/payload";

const TOUCH = "min-h-11";

function PageMenu({ owner }: { owner: boolean }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="More"
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground data-[state=open]:bg-card"
      >
        <MoreHorizontal className="size-5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-auto items-center gap-1 p-1.5">
        {owner && <ShareButton />}
        {owner && <RebuildButton />}
        <ThemeButton />
        {owner && <ShutdownButton />}
      </PopoverContent>
    </Popover>
  );
}

// The section a jump points into: a section by number, or the first section holding a hunk or file.
function sectionOf(layer: ReturnType<typeof useLayer>, anchor: string | null) {
  const target = anchor ? parseTarget(anchor) : null;
  if (!layer || !target) {
    return undefined;
  }
  if (target.section !== undefined) {
    return target.section;
  }
  const { owner } = indexLayer(layer);
  if (target.hunk) {
    return owner.get(target.hunk);
  }
  const at = layer.sections.findIndex(section => section.files.some(part => part.id === target.file));
  return at < 0 ? undefined : at;
}

// One file's card on the whole screen, with the way back to its section and on to the next file.
function FileScreen({
  layer,
  title,
  part,
  section,
  onBack,
  onNext,
}: {
  layer: number;
  title: string;
  part: { id: string; hunks: string[] };
  section: number;
  onBack: () => void;
  onNext: (() => void) | null;
}) {
  const shown = useLayer(layer);
  const setTicks = useSetTicks();
  if (!shown) {
    return null;
  }
  const key = tickKey(shown, part.id, part.hunks);
  return (
    <div className="grid content-start gap-3 pb-4">
      <Button variant="ghost" className={cn("justify-self-start", TOUCH)} onClick={onBack}>
        <ChevronLeft />
        {title}
      </Button>
      <FileCard layer={layer} file={part.id} hunkIds={part.hunks} section={section} />
      <Button
        className={cn("w-full", TOUCH)}
        onClick={() => {
          setTicks([key], true);
          (onNext ?? onBack)();
        }}
      >
        {onNext ? "Reviewed, next file" : "Reviewed, back to the section"}
      </Button>
    </div>
  );
}

// The Changes view on a phone: one section at a time, its explanation and its files as rows that each open a file
// on the whole screen.
function PhoneChanges({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const show = useViewStore(state => state.show);
  const formatting = useViewStore(state => state.formatting);
  const anchor = useViewStore(state => state.anchor);
  const goTo = useViewStore(state => state.goTo);
  const ticked = useTicks();
  const setTicks = useSetTicks();
  const sections = useMemo(() => (shown ? shownSections(shown, show, formatting) : []), [shown, show, formatting]);
  const homes = useMemo(() => diagramHomes(shown?.diagrams ?? [], sections), [shown, sections]);
  const [file, setFile] = useState<number | null>(null);
  const jumped = sectionOf(shown, anchor);
  const [at, setAt] = useState(0);
  // A jump from elsewhere (a link, the ready check, a thread's Show it) opens the section it points into.
  useEffect(() => {
    const step = sections.findIndex(section => section.index === jumped);
    if (step >= 0) {
      setAt(step);
      setFile(null);
    }
  }, [jumped, sections]);
  // A file or another section starts at its top, not wherever the last one was scrolled to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scroll is to happen whenever these change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [file, at]);
  if (!shown) {
    return null;
  }
  if (!sections.length) {
    return (
      <div className="py-4">
        <FileList layer={layer} />
      </div>
    );
  }
  const step = Math.min(at, sections.length - 1);
  const current = sections[step];
  if (!current) {
    return null;
  }
  const count = shown.sections.filter(section => section.kind === "guide").length;
  const move = (by: number) => {
    const next = sections[step + by];
    if (next) {
      setFile(null);
      goTo(layer, `s${next.index + 1}`);
    }
  };
  const title = current.section.kind === "guide" ? `Section ${pad2(current.index + 1)}` : current.section.title;
  if (file !== null && current.parts[file]) {
    return (
      <FileScreen
        layer={layer}
        title={title}
        part={current.parts[file]}
        section={current.index}
        onBack={() => setFile(null)}
        onNext={file + 1 < current.parts.length ? () => setFile(file + 1) : null}
      />
    );
  }
  return (
    <section id={sectionElementId(layer, current.index)} data-section={current.index} className="grid content-start gap-4 pb-4">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-11"
          aria-label="Previous section"
          disabled={step === 0}
          onClick={() => move(-1)}
        >
          <ChevronLeft />
        </Button>
        <div className="grid flex-1 justify-items-center gap-1">
          <span className="flex gap-1" aria-hidden>
            {sections.map((section, index) => (
              <span
                key={section.index}
                className={cn(
                  "h-1 w-6 rounded-full",
                  index === step ? "bg-primary" : sectionTickKeys(shown, section.index).every(ticked) ? "bg-primary/40" : "bg-muted",
                )}
              />
            ))}
          </span>
          <span className="text-muted-foreground text-xs">
            Section {step + 1} of {sections.length}
          </span>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="size-11"
          aria-label="Next section"
          disabled={step === sections.length - 1}
          onClick={() => move(1)}
        >
          <ChevronRight />
        </Button>
      </div>
      <h2 className="text-balance font-serif text-xl leading-tight">{current.section.title}</h2>
      <SectionText layer={layer} shown={current} count={count} />
      {(homes.get(current.index) ?? []).map(index => (
        <DiagramCard key={index} layer={layer} index={index} />
      ))}
      <ul className="grid gap-2" aria-label="Open a file">
        {current.parts.map((part, index) => {
          const reviewed = ticked(tickKey(shown, part.id, part.hunks));
          const path = indexLayer(shown).files.get(part.id)?.path ?? part.id;
          return (
            <li key={part.id}>
              <button
                type="button"
                onClick={() => setFile(index)}
                className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md border bg-card px-3 text-left text-sm"
              >
                <span className={cn("min-w-0 flex-1 truncate", reviewed && "text-muted-foreground")}>
                  {reviewed && <span className="text-success">✓ </span>}
                  {path.split("/").at(-1)}
                </span>
                <span className="font-mono text-muted-foreground text-xs">{plural(part.hunks.length, "hunk")}</span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            </li>
          );
        })}
      </ul>
      <Button
        className={cn("w-full", TOUCH)}
        onClick={() => {
          setTicks(sectionTickKeys(shown, current.index), true);
          move(1);
        }}
      >
        {step < sections.length - 1 ? "Mark reviewed, next section" : "Mark reviewed"}
      </Button>
    </section>
  );
}

function Place({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-current={on ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "min-h-12 flex-1 cursor-pointer text-sm",
        on ? "font-medium text-foreground shadow-[inset_0_2px_0_var(--primary)]" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

// The page on a phone: the title and a menu at the top, one place at a time, and the places along the bottom where a
// thumb reaches them.
export function PhoneShell({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const stacked = Boolean(useReview().data?.stack);
  const owner = useIsOwner();
  const tab = useViewStore(state => state.tab);
  const setTab = useViewStore(state => state.setTab);
  const { chatOpen, setChatOpen, openDrawer } = useChatStore();
  const { threads, yours } = useThreads();
  if (!shown) {
    return null;
  }
  const open = threads.filter(t => t.root.status !== "draft" && !t.root.resolved).length;
  const place = chatOpen ? "claude" : tab === "overview" ? "overview" : "changes";
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/95 px-4 py-1.5 backdrop-blur">
        {stacked ? (
          <LayerNav />
        ) : (
          <h1 className="min-w-0 flex-1 truncate font-serif text-base">
            {shown.meta.number ? <span className="mr-1.5 font-mono text-muted-foreground text-xs">#{shown.meta.number}</span> : null}
            {shown.meta.title}
          </h1>
        )}
        {stacked && <span className="flex-1" />}
        <ReadyPill layer={layer} />
        <PageMenu owner={owner} />
      </header>
      <main className="min-w-0 flex-1 px-4 pt-3">
        {place === "claude" ? <ClaudePanel page /> : place === "overview" ? <Overview layer={layer} /> : <PhoneChanges layer={layer} />}
      </main>
      <nav
        aria-label="Places"
        className="sticky bottom-0 z-30 flex border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <Place
          on={place === "overview"}
          onClick={() => {
            setChatOpen(false);
            setTab("overview");
          }}
        >
          Overview
        </Place>
        <Place
          on={place === "changes"}
          onClick={() => {
            setChatOpen(false);
            setTab("guide");
          }}
        >
          Changes
        </Place>
        <Place on={place === "claude"} onClick={() => openDrawer("chat")}>
          Claude{open ? ` (${open})` : ""}
          {yours.length > 0 && <span className="ml-1 inline-block size-2 rounded-full bg-primary" />}
        </Place>
      </nav>
    </div>
  );
}
