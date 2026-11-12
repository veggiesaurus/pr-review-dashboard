import { Check, ChevronUp } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { type MouseEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";

import { Popover, PopoverAnchor, PopoverContent } from "src/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "src/components/ui/tooltip";
import { applyPalette, currentPalette, type Palette } from "src/utils/palette";

const KEY = "prg:theme";

// The icons and the system, light, dark cycle are the skill's page template's.
const THEMES: { value: string; name: string; icon: ReactNode }[] = [
  {
    value: "",
    name: "System",
    icon: (
      <>
        <circle cx="8" cy="8" r="6" />
        <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
      </>
    ),
  },
  {
    value: "light",
    name: "Light",
    icon: (
      <>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" />
      </>
    ),
  },
  { value: "dark", name: "Dark", icon: <path d="M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7z" /> },
];

// A palette at a glance: its page, primary, secondary and accent colours in the mode the page is in.
function Swatch({ colours }: { colours: Record<string, string> }) {
  return (
    <span aria-hidden className="flex h-4 w-12 shrink-0 overflow-hidden rounded-sm border" style={{ borderColor: colours.border }}>
      {["background", "primary", "secondary", "accent"].map(key => (
        <span key={key} className="flex-1" style={{ background: colours[key] }} />
      ))}
    </span>
  );
}

// Click cycles system, light and dark. Shift-click opens the tweakcn palettes, fetched only then.
export function ThemeButton() {
  const [value, setValue] = useState(() => document.documentElement.dataset.theme ?? "");
  const [open, setOpen] = useState(false);
  const [palettes, setPalettes] = useState<Palette[]>();
  const [palette, setPalette] = useState(currentPalette);
  const hold = useRef<ReturnType<typeof setTimeout>>(undefined);
  const held = useRef(false);
  // A hold opens the palettes while the finger is still down, and what the phone sends as the press ends (focus
  // going back to the button, its own long-press menu) can close them again. So nothing that happens on the button
  // closes them, and for a moment after a hold nothing else does either.
  const settling = useRef(0);
  const anchor = useRef<HTMLButtonElement>(null);
  const index = Math.max(
    0,
    THEMES.findIndex(theme => theme.value === value),
  );
  const current = THEMES[index];
  const next = THEMES[(index + 1) % THEMES.length];
  if (!current || !next) {
    return null;
  }

  const cycle = () => {
    if (next.value) {
      document.documentElement.dataset.theme = next.value;
    } else {
      delete document.documentElement.dataset.theme;
    }
    try {
      localStorage.setItem(KEY, next.value);
    } catch {
      // Storage can be blocked; the theme still changes for this visit.
    }
    setValue(next.value);
  };

  // Opened once the list is there, so the focus lands on the palette in use.
  const openPalettes = () => {
    import("src/styles/palettes").then(module => {
      setPalettes(module.PALETTES);
      setOpen(true);
    });
  };
  // A touch screen has no shift key, so holding the button opens the palettes there. The tap that ends the hold is
  // not also a click.
  const onPointerDown = (event: PointerEvent) => {
    held.current = false;
    if (event.pointerType !== "mouse") {
      hold.current = setTimeout(() => {
        held.current = true;
        settling.current = Date.now() + 900;
        openPalettes();
      }, 450);
    }
  };
  const release = () => clearTimeout(hold.current);
  const onClick = (event: MouseEvent) => {
    if (held.current) {
      held.current = false;
    } else if (open) {
      // With the palettes up the button puts them away, and shows a chevron to say so.
      setOpen(false);
    } else if (event.shiftKey) {
      openPalettes();
    } else {
      cycle();
    }
  };
  const pick = (name: string) => {
    const picked = palettes?.find(entry => entry.name === name);
    if (picked) {
      applyPalette(picked);
      setPalette(name);
    }
  };
  const dark = value ? value === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;

  const title = open
    ? `Theme: ${current.name}. Click to close the palettes.`
    : `Theme: ${current.name}. Click for ${next.name}; shift-click, right-click or hold for the palettes.`;
  const button = (
    <button
      ref={anchor}
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      // The browser's own long-press or right-click menu would cover the palettes, so that opens them too.
      onContextMenu={event => {
        event.preventDefault();
        release();
        if (event.nativeEvent instanceof PointerEvent && event.nativeEvent.pointerType !== "mouse") {
          held.current = true;
          settling.current = Date.now() + 900;
        }
        openPalettes();
      }}
      aria-label={title}
      aria-expanded={open}
      className="grid size-7 cursor-pointer select-none place-items-center rounded-full [-webkit-touch-callout:none] border border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground focus-visible:border-border focus-visible:bg-card focus-visible:text-foreground"
    >
      {open ? (
        <ChevronUp className="size-4" aria-hidden="true" />
      ) : (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-4"
        >
          {current.icon}
        </svg>
      )}
    </button>
  );
  return (
    <Popover open={open} onOpenChange={next => (next || Date.now() > settling.current) && setOpen(next)}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <PopoverAnchor asChild>{button}</PopoverAnchor>
        </TooltipTrigger>
        {!open && (
          <TooltipContent side="bottom" align="end">
            Theme: {current.name}
            <span className="block opacity-70">Click for {next.name}. Shift-click or right-click for the palettes.</span>
          </TooltipContent>
        )}
      </Tooltip>
      <PopoverContent
        align="end"
        className="w-64 p-1"
        onInteractOutside={event => anchor.current?.contains(event.target as Node) && event.preventDefault()}
      >
        <RadioGroup.Root
          value={palette}
          onValueChange={pick}
          aria-label="Palette"
          className="grid max-h-[min(26rem,60vh)] overflow-y-auto overscroll-contain"
        >
          {palettes?.map(entry => (
            <RadioGroup.Item
              key={entry.name}
              value={entry.name}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
            >
              <Swatch colours={dark ? entry.dark : entry.light} />
              <span className="min-w-0 flex-1 truncate">{entry.title}</span>
              <RadioGroup.Indicator>
                <Check className="size-4 text-primary" />
              </RadioGroup.Indicator>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </PopoverContent>
    </Popover>
  );
}
