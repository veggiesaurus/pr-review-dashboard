import { useEffect, useState } from "react";

import type { MarkColours, Rgb } from "src/components/visualize/source";

type Mermaid = typeof import("mermaid")["default"];

// Loaded only when the tab opens: it is most of the page's weight.
let loading: Promise<Mermaid> | undefined;
const load = () => {
  loading ??= import("mermaid").then(module => module.default);
  return loading;
};

export type DiagramTheme = { key: string; variables: Record<string, string | boolean>; marks: MarkColours };

let canvas: CanvasRenderingContext2D | null | undefined;
// Mermaid does its own colour maths, which reads hex and rgb but not the oklch the tokens are written in, so each
// token is painted once and read back.
function rgbOf(value: string): Rgb {
  canvas ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!canvas) {
    return [128, 128, 128];
  }
  canvas.clearRect(0, 0, 1, 1);
  canvas.fillStyle = "#808080";
  canvas.fillStyle = value;
  canvas.fillRect(0, 0, 1, 1);
  const [r = 128, g = 128, b = 128] = canvas.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

let fontsLoaded = 0;

function readTheme(): DiagramTheme {
  const style = getComputedStyle(document.documentElement);
  const rgb = (token: string) => rgbOf(style.getPropertyValue(`--${token}`).trim());
  const css = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`;
  const token = (name: string) => css(rgb(name));
  const [r, g, b] = rgb("background");
  const font = style.getPropertyValue("--font-sans").trim() || "sans-serif";
  const ink = token("foreground");
  const quiet = token("muted-foreground");
  const card = token("card");
  const muted = token("muted");
  const border = token("border");
  // Untouched parts are drawn quietly, so the ones the change marks stand out.
  const variables = {
    darkMode: (r * 299 + g * 587 + b * 114) / 1000 < 128,
    background: card,
    fontFamily: font,
    fontSize: "14px",
    textColor: ink,
    titleColor: ink,
    lineColor: quiet,
    primaryColor: muted,
    primaryTextColor: ink,
    primaryBorderColor: quiet,
    secondaryColor: muted,
    secondaryTextColor: ink,
    secondaryBorderColor: border,
    tertiaryColor: card,
    tertiaryTextColor: ink,
    tertiaryBorderColor: border,
    mainBkg: muted,
    nodeBorder: quiet,
    nodeTextColor: ink,
    clusterBkg: card,
    clusterBorder: border,
    edgeLabelBackground: card,
    noteBkgColor: card,
    noteTextColor: ink,
    noteBorderColor: border,
    actorBkg: muted,
    actorBorder: quiet,
    actorTextColor: ink,
    actorLineColor: border,
    signalColor: quiet,
    signalTextColor: ink,
    labelBoxBkgColor: card,
    labelBoxBorderColor: quiet,
    labelTextColor: ink,
    loopTextColor: ink,
    activationBkgColor: muted,
    activationBorderColor: quiet,
    sequenceNumberColor: token("primary-foreground"),
  };
  const marks: MarkColours = {
    added: { fill: rgb("diff-add"), stroke: rgb("success") },
    changed: { fill: rgb("accent"), stroke: rgb("primary") },
    removed: { fill: rgb("diff-del"), stroke: rgb("danger") },
  };
  return { key: JSON.stringify([variables, marks, fontsLoaded]), variables, marks };
}

// The theme as mermaid takes it, read again whenever the light or dark choice, the palette, the system's scheme or
// the loaded fonts change. Mermaid sizes boxes by measuring text, so a palette's fonts arriving means drawing again.
export function useDiagramTheme() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const check = () =>
      setTheme(last => {
        const next = readTheme();
        return next.key === last.key ? last : next;
      });
    const fonts = () => {
      fontsLoaded++;
      check();
    };
    const watch = new MutationObserver(check);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette", "class"] });
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", check);
    document.fonts.addEventListener("loadingdone", fonts);
    return () => {
      watch.disconnect();
      scheme.removeEventListener("change", check);
      document.fonts.removeEventListener("loadingdone", fonts);
    };
  }, []);
  return theme;
}

let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

// One at a time: mermaid's configuration is global, so each drawing sets it and draws before the next starts.
export function renderDiagram(text: string, theme: DiagramTheme): Promise<string> {
  const next = queue.then(async () => {
    const mermaid = await load();
    await document.fonts.ready;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "base",
      themeVariables: theme.variables,
      fontFamily: String(theme.variables.fontFamily),
      sequence: { useMaxWidth: true },
      flowchart: { useMaxWidth: true },
    });
    const { svg } = await mermaid.render(`prg-mmd-${++counter}`, text);
    return svg;
  });
  queue = next.catch(() => undefined);
  return next;
}
