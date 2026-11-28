import { Check } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { type ReactNode, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "src/components/ui/popover";
import { applyPalette, currentPalette, type Palette } from "src/utils/palette";

const KEY = "prg:theme";

// The icons are the skill's page template's.
const MODES: { value: string; name: string; icon: ReactNode }[] = [
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
  {
    value: "system",
    name: "System",
    icon: (
      <>
        <circle cx="8" cy="8" r="6" />
        <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
      </>
    ),
  },
];

const Icon = ({ children }: { children: ReactNode }) => (
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
    {children}
  </svg>
);

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

// One menu: light, dark or system across the top, then the tweakcn palettes, fetched the first time it opens.
export function ThemeButton() {
  const [mode, setMode] = useState(() => document.documentElement.dataset.theme ?? "system");
  const [palettes, setPalettes] = useState<Palette[]>();
  const [palette, setPalette] = useState(currentPalette);
  const current = MODES.find(entry => entry.value === mode) ?? MODES[2];

  const pickMode = (value: string) => {
    if (value !== "system") {
      document.documentElement.dataset.theme = value;
    } else {
      delete document.documentElement.dataset.theme;
    }
    try {
      localStorage.setItem(KEY, value === "system" ? "" : value);
    } catch {
      // Storage can be blocked; the theme still changes for this visit.
    }
    setMode(value);
  };
  const pickPalette = (name: string) => {
    const picked = palettes?.find(entry => entry.name === name);
    if (picked) {
      applyPalette(picked);
      setPalette(name);
    }
  };
  const onOpenChange = (open: boolean) => {
    if (open && !palettes) {
      import("src/styles/palettes").then(module => setPalettes(module.PALETTES));
    }
  };
  const dark = mode !== "system" ? mode === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Theme: ${current?.name}`}
          className="grid size-7 cursor-pointer place-items-center rounded-full pointer-coarse:size-11 border border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground focus-visible:border-border focus-visible:bg-card focus-visible:text-foreground"
        >
          <Icon>{current?.icon}</Icon>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        <RadioGroup.Root
          value={mode}
          onValueChange={pickMode}
          aria-label="Mode"
          orientation="horizontal"
          className="grid grid-cols-3 gap-1 p-1"
        >
          {MODES.map(entry => (
            <RadioGroup.Item
              key={entry.name}
              value={entry.value}
              aria-label={entry.name}
              title={entry.name}
              className="flex h-8 cursor-pointer items-center justify-center rounded-md border text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-primary data-[state=checked]:bg-accent data-[state=checked]:text-foreground"
            >
              <Icon>{entry.icon}</Icon>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
        <div className="mt-1 border-t px-2 pt-2 pb-1 font-medium text-muted-foreground text-xs">Palette</div>
        <RadioGroup.Root
          value={palette}
          onValueChange={pickPalette}
          aria-label="Palette"
          className="grid max-h-[min(26rem,60vh)] overflow-y-auto overscroll-contain"
        >
          {!palettes && <p className="px-2 py-1.5 text-muted-foreground">Loading…</p>}
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
