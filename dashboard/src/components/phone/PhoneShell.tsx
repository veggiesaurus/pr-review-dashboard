import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { type ReactNode, type TouchEvent, useEffect, useMemo, useRef, useState } from "react";

import { ClaudePanel } from "src/components/chat/ClaudePanel";
import { useChatStore } from "src/components/chat/chat.store";
import { RebuildButton } from "src/components/chat/RebuildButton";
import { useThreads } from "src/components/chat/useThreads";
import { FileCard } from "src/components/diff/FileCard";
import { FileList } from "src/components/guide/DiffTab";
import { diagramHomes, SectionText } from "src/components/guide/Guide";
import { lineCounts, pad2, shownSections, splitPath } from "src/components/guide/visible";
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
        className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground data-[state=open]:bg-card"
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

// Whether a touch began on something that scrolls sideways itself (a wide diagram, the readers' switch), which keeps
// the swipe rather than giving it to the section.
function scrollsSideways(target: EventTarget | null) {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowX;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollWidth > el.clientWidth) {
      return true;
    }
  }
  return false;
}

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// The section follows a sideways drag like a carousel's page. Let go past a third of the screen, or with a flick, and
// it slides off for the next or previous one; otherwise it springs back. With nothing that way it drags stiffly.
function useCarousel(canGo: (by: 1 | -1) => boolean, onGo: (by: 1 | -1) => void) {
  const page = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; at: number; axis: "x" | "y" | null } | null>(null);
  const place = (x: string, animate: boolean) => {
    const el = page.current;
    if (el) {
      el.style.transition = animate && !still() ? "transform var(--motion-base) var(--motion-ease)" : "none";
      el.style.transform = x === "0" ? "" : `translateX(${x})`;
    }
  };
  const handlers = {
    onTouchStart: (event: TouchEvent) => {
      const touch = event.touches[0];
      start.current =
        touch && event.touches.length === 1 && !scrollsSideways(event.target)
          ? { x: touch.clientX, y: touch.clientY, at: event.timeStamp, axis: null }
          : null;
    },
    onTouchMove: (event: TouchEvent) => {
      const from = start.current;
      const touch = event.touches[0];
      if (!from || !touch) {
        return;
      }
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      // The first few pixels decide whether this is a swipe or a scroll down the page.
      from.axis ??= Math.abs(dx) > 8 || Math.abs(dy) > 8 ? (Math.abs(dx) > Math.abs(dy) ? "x" : "y") : null;
      if (from.axis === "x") {
        place(`${canGo(dx < 0 ? 1 : -1) ? dx : dx / 3}px`, false);
      }
    },
    onTouchEnd: (event: TouchEvent) => {
      const from = start.current;
      const touch = event.changedTouches[0];
      start.current = null;
      if (!from || !touch || from.axis !== "x") {
        return;
      }
      const dx = touch.clientX - from.x;
      const by = dx < 0 ? 1 : -1;
      const flick = Math.abs(dx) > 40 && Math.abs(dx) / Math.max(1, event.timeStamp - from.at) > 0.5;
      if (canGo(by) && (Math.abs(dx) > window.innerWidth / 3 || flick)) {
        place(by === 1 ? "-100%" : "100%", true);
        window.setTimeout(() => onGo(by), still() ? 0 : 200);
      } else {
        place("0", true);
      }
    },
    onTouchCancel: () => {
      start.current = null;
      place("0", true);
    },
  };
  return { page, handlers };
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
  const setAnchor = useViewStore(state => state.setAnchor);
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
  // Hooks come before the returns below, so the swipe asks and calls whichever step is current.
  const steps = useRef<{ can: (by: 1 | -1) => boolean; move: (by: 1 | -1) => void }>({ can: () => false, move: () => {} });
  const carousel = useCarousel(
    by => steps.current.can(by),
    by => steps.current.move(by),
  );
  // The side the next section slides in from, set by the step that brings it.
  const enter = useRef<1 | -1 | null>(null);
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
  const move = (by: 1 | -1) => {
    const next = sections[step + by];
    if (next) {
      enter.current = by;
      setFile(null);
      // Not a jump: a jump scrolls the section's top under the header, arrows and all. The page goes to its top instead.
      setAnchor(`s${next.index + 1}`);
    }
  };
  steps.current = { can: by => Boolean(sections[step + by]), move };
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
    // The arrows and the count stay put; only the section's own content slides, as a carousel's page does.
    <section
      id={sectionElementId(layer, current.index)}
      data-section={current.index}
      className="grid touch-pan-y scroll-mt-16 content-start gap-4 pb-4"
      {...carousel.handlers}
    >
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
          <span className="relative flex gap-1" aria-hidden>
            {sections.map(section => (
              <span
                key={section.index}
                className={cn("h-1 w-6 rounded-full", sectionTickKeys(shown, section.index).every(ticked) ? "bg-primary/40" : "bg-muted")}
              />
            ))}
            {/* The one marker for where you are, sliding along the dots. */}
            <span
              className="absolute top-0 left-0 h-1 w-6 rounded-full bg-primary transition-[translate] duration-(--motion-base) ease-(--motion-ease)"
              style={{ translate: `calc(${step} * 1.75rem) 0` }}
            />
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
      <div
        key={current.index}
        ref={carousel.page}
        className={cn("grid content-start gap-4", enter.current === 1 && "motion-slide-next", enter.current === -1 && "motion-slide-prev")}
      >
        <h2 className="text-balance font-serif text-xl leading-tight">{current.section.title}</h2>
        <SectionText layer={layer} shown={current} count={count} files={false} />
        {(homes.get(current.index) ?? []).map(index => (
          <DiagramCard key={index} layer={layer} index={index} />
        ))}
        <ul className="grid gap-2" aria-label="Open a file">
          {current.parts.map((part, index) => {
            const reviewed = ticked(tickKey(shown, part.id, part.hunks));
            const file = indexLayer(shown).files.get(part.id);
            const { name, dir } = splitPath(file?.path ?? part.id);
            const { add, del } = file ? lineCounts(file, part.hunks) : { add: 0, del: 0 };
            return (
              <li key={part.id}>
                <button
                  type="button"
                  onClick={() => setFile(index)}
                  className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md border bg-card px-3 text-left text-sm"
                >
                  <span className={cn("min-w-0 flex-1 truncate", reviewed && "text-muted-foreground")}>
                    {reviewed && <span className="text-success">✓ </span>}
                    <span className="font-medium">{name}</span>
                    {dir && <span className="ml-1.5 text-muted-foreground text-xs">{dir}</span>}
                  </span>
                  <span className="shrink-0 font-mono text-xs">
                    {add > 0 && <span className="text-success">+{add}</span>} {del > 0 && <span className="text-danger">−{del}</span>}
                  </span>
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
      </div>
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
      {/* The title would only ever show cut short here, and the Overview leads with it in full. */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/95 px-4 py-1 backdrop-blur">
        {stacked ? (
          <LayerNav />
        ) : (
          <h1 className="min-w-0 flex-1">
            {shown.meta.number ? <span className="font-mono text-muted-foreground text-xs">#{shown.meta.number}</span> : null}
            <span className="sr-only"> {shown.meta.title}</span>
          </h1>
        )}
        {stacked && <span className="flex-1" />}
        <ReadyPill layer={layer} />
        <PageMenu owner={owner} />
      </header>
      <main className="min-w-0 flex-1 overflow-x-clip px-4 pt-3">
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
