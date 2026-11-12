import { api } from "src/queries/api";

// A tweakcn theme laid over the page's own: its colours for both modes, its radius and its fonts. load is the
// families the server fetches from Google Fonts; the rest of each stack is already on the reader's machine.
export type Palette = {
  name: string;
  title: string;
  radius: string;
  light: Record<string, string>;
  dark: Record<string, string>;
  fonts: { sans: string; serif: string; mono: string };
  load: string[];
};

const KEY = "prg:palette";
const STYLE = "prg-palette";
export const DEFAULT_PALETTE = "claude";

const block = (vars: Record<string, string>) =>
  Object.entries(vars)
    .map(([key, value]) => `--${key}:${value};`)
    .join("");

// theme.css's three rules, each one step more specific, so they win wherever the style element lands.
export const paletteCss = (palette: Palette) =>
  `:root[data-palette]{--radius:${palette.radius};--font-sans:${palette.fonts.sans};--font-serif:${palette.fonts.serif};--font-mono:${palette.fonts.mono};${block(palette.light)}}` +
  `@media (prefers-color-scheme:dark){:root[data-palette]:not([data-theme="light"]){${block(palette.dark)}}}` +
  `:root[data-palette][data-theme="dark"]{${block(palette.dark)}}`;

export const currentPalette = () => document.documentElement.dataset.palette ?? DEFAULT_PALETTE;

function keep(name: string, css: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ name, css }));
  } catch {
    // Storage can be blocked; the palette still changes for this visit.
  }
}

// The colours change at once and the fonts follow when they arrive, unless another palette was picked meanwhile.
async function loadFonts(palette: Palette, style: HTMLElement) {
  const sheets = await Promise.allSettled(palette.load.map(family => api.get("fonts/css", { searchParams: { family } }).text()));
  const faces = sheets.flatMap(sheet => (sheet.status === "fulfilled" ? [sheet.value] : [])).join("\n");
  if (faces && document.documentElement.dataset.palette === palette.name) {
    style.textContent = `${faces}\n${paletteCss(palette)}`;
    keep(palette.name, style.textContent);
  }
}

// The page's own theme needs no rules. The CSS is kept with the name so theme-init.js can put it back before first paint.
export function applyPalette(palette: Palette) {
  const root = document.documentElement;
  const own = palette.name === DEFAULT_PALETTE;
  let style = document.getElementById(STYLE);
  if (own) {
    style?.remove();
    delete root.dataset.palette;
  } else {
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE;
      document.head.append(style);
    }
    style.textContent = paletteCss(palette);
    root.dataset.palette = palette.name;
    keep(palette.name, style.textContent);
    if (palette.load.length) {
      loadFonts(palette, style);
    }
    return;
  }
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing was kept if storage is blocked.
  }
}
