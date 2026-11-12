import { Keyboard } from "lucide-react";
import { useEffect } from "react";

import { useGapStore } from "src/components/diff/gaps.store";
import { cardElements, currentCard, currentHunk, currentSection, land, sectionElements, step } from "src/components/guide/nav";
import { Kbd } from "src/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "src/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "src/components/ui/tooltip";
import { useViewStore } from "src/store/view.store";
import type { Tab } from "src/utils/anchors";
import { settleLayout } from "src/utils/motion";

const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = MAC ? "⌘" : "Ctrl";
const ALT = MAC ? "⌥" : "Alt";

// ⌘B, ⌘P, ⌥⌘G and ⌘/ are Linear's own; Linear publishes no keys for moving between files or sections or for ticking them.
const KEYS: { keys: string[][]; sep?: string; what: string }[] = [
  { keys: [["j"], ["k"]], sep: "/", what: "Next or previous file" },
  { keys: [["n"], ["p"]], sep: "/", what: "Next or previous section" },
  { keys: [["r"]], what: "Mark the file you're on reviewed, or not" },
  { keys: [["Shift", "R"]], what: "Mark the section you're on reviewed, or not" },
  {
    keys: [
      ["Shift", "↑"],
      ["Shift", "↓"],
    ],
    sep: "/",
    what: "Show more unchanged lines above or below the change you're on",
  },
  { keys: [[ALT, "E"]], what: "Show all unchanged lines in the file you're on, or hide them again" },
  { keys: [[MOD, "P"]], what: "Go to a file" },
  { keys: [[ALT, MOD, "G"]], what: "Go to a section" },
  { keys: [["u"]], what: "Where a name is used" },
  { keys: [["1"], ["2"], ["3"]], what: "Overview, Guide, Diff" },
  { keys: [[MOD, "B"]], what: "Unified or Split" },
  { keys: [["?"], [MOD, "/"]], sep: "or", what: "These keys" },
];

const TABS: Record<string, Tab> = { "1": "overview", "2": "guide", "3": "diff" };
const NOT_TYPING = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

function typing(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  // An open menu takes letters for itself, to jump to the option that starts with them.
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target.closest("[role=listbox]")) {
    return true;
  }
  return target instanceof HTMLInputElement && !NOT_TYPING.has(target.type);
}

function move(elements: HTMLElement[], direction: 1 | -1) {
  const to = step(elements, direction);
  if (to) {
    land(to);
  }
}

function tick(element: HTMLElement | undefined, kind: "card" | "section") {
  element?.querySelector<HTMLInputElement>(`input[data-tick="${kind}"]:not(:disabled)`)?.click();
}

// Opens every gap of the card you're on, opening the card too, or closes them all when none is left to open.
function toggleGaps() {
  const card = currentCard(cardElements());
  if (!card) {
    return false;
  }
  const open = card.querySelector("tbody[data-gap-hidden]") !== null;
  const body = card.querySelector(":scope > details");
  if (open && body instanceof HTMLDetailsElement) {
    body.open = true;
  }
  useGapStore.getState().send({ card: card.id, act: open ? "open" : "close" });
  return true;
}

function stepGap(act: "up" | "down") {
  const card = currentCard(cardElements());
  const hunk = currentHunk(card)?.dataset.hunk;
  if (!card || !hunk) {
    return false;
  }
  useGapStore.getState().send({ card: card.id, act, hunk });
  return true;
}

// The page's keys. None of them fire while a field has the focus.
export function useKeyboard() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || typing(event.target)) {
        return;
      }
      // A card still folding from the last r would put the next j in the wrong place.
      settleLayout();
      const view = useViewStore.getState();
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "b") {
        view.setLayout(view.layout === "split" ? "unified" : "split");
      } else if (mod && !event.altKey && !event.shiftKey && event.code === "KeyP") {
        view.setJump("file");
      } else if (mod && event.altKey && !event.shiftKey && event.code === "KeyG") {
        view.setJump("section");
      } else if (mod && !event.altKey && event.key === "/") {
        view.setKeysOpen(!view.keysOpen);
      } else if (event.altKey && !mod && !event.shiftKey && event.code === "KeyE") {
        if (!toggleGaps()) {
          return;
        }
      } else if (event.shiftKey && !mod && !event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        if (!stepGap(event.key === "ArrowUp" ? "up" : "down")) {
          return;
        }
      } else if (mod || event.altKey) {
        return;
      } else if (event.key === "?") {
        view.setKeysOpen(!view.keysOpen);
      } else if (event.key === "j" || event.key === "k") {
        move(cardElements(), event.key === "j" ? 1 : -1);
      } else if (event.key === "n" || event.key === "p") {
        move(sectionElements(), event.key === "n" ? 1 : -1);
      } else if (event.key === "r") {
        tick(currentCard(cardElements()), "card");
      } else if (event.key === "R") {
        tick(currentSection(sectionElements()), "section");
      } else if (event.key === "u") {
        view.setJump("usages");
      } else if (TABS[event.key]) {
        view.setTab(TABS[event.key] ?? "overview");
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// The keys, from a small button in the page's top corner or ?.
export function KeysHelp() {
  const open = useViewStore(state => state.keysOpen);
  const setOpen = useViewStore(state => state.setKeysOpen);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <PopoverTrigger
            className="grid size-7 cursor-pointer place-items-center rounded-full border border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground focus-visible:border-border focus-visible:bg-card focus-visible:text-foreground data-[state=open]:border-border data-[state=open]:bg-card data-[state=open]:text-foreground"
            aria-label="Keyboard keys"
          >
            <Keyboard className="size-4" />
          </PopoverTrigger>
        </TooltipTrigger>
        {!open && (
          <TooltipContent side="bottom" align="end">
            Keyboard keys <Kbd>?</Kbd>
          </TooltipContent>
        )}
      </Tooltip>
      <PopoverContent align="end" className="w-[25rem]">
        <p className="mb-2 font-medium">Keys</p>
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {KEYS.map(row => (
              <tr key={row.what}>
                <td className="whitespace-nowrap py-1 pr-4 align-top">
                  {row.keys.map((combo, index) => (
                    <span key={combo.join("+")}>
                      {index > 0 && <span className="px-1 text-muted-foreground">{row.sep}</span>}
                      <span className="inline-flex gap-0.5">
                        {combo.map(name => (
                          <Kbd key={name}>{name}</Kbd>
                        ))}
                      </span>
                    </span>
                  ))}
                </td>
                <td className="py-1 text-foreground/80">{row.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-muted-foreground text-xs">Not while you're typing in a field.</p>
      </PopoverContent>
    </Popover>
  );
}
