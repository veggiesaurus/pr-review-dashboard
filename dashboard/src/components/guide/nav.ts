import { flash } from "src/utils/anchors";
import { settleLayout } from "src/utils/motion";

// Where keyboard jumps and the rail's jumps land: the element's top this far below the top of the window.
const LANDING = 16;

const drawn = (element: Element) => element.getClientRects().length > 0;
const top = (element: Element) => element.getBoundingClientRect().top;
const atBottom = () => window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;

export const sectionElements = () => [...document.querySelectorAll<HTMLElement>("main [data-section]")];
export const cardElements = () => [...document.querySelectorAll<HTMLElement>("main [data-card]")].filter(drawn);

// The section being read: the last whose top has passed a line a little way down the window, or the last one once
// the page can't scroll any further.
export function currentSection(elements: HTMLElement[]) {
  if (atBottom()) {
    return elements.at(-1);
  }
  const line = Math.min(160, window.innerHeight * 0.3);
  return elements.findLast(element => top(element) <= line) ?? elements[0];
}

// The card at the landing line, where j and k put one, so a card that folds when ticked stays the current one;
// failing that, the first card in view.
export function currentCard(elements: HTMLElement[]) {
  const at = elements.findLast(element => top(element) <= LANDING + 8);
  if (at && at.getBoundingClientRect().bottom > LANDING) {
    return at;
  }
  return elements.find(element => top(element) >= 0) ?? at;
}

// The hunk being read in a card: the last whose top has passed a line a little way down the window, else the first.
export function currentHunk(card: HTMLElement | undefined) {
  const hunks = [...(card?.querySelectorAll<HTMLElement>("tbody[data-hunk]") ?? [])].filter(drawn);
  const line = Math.min(160, window.innerHeight * 0.3);
  return hunks.findLast(hunk => top(hunk) <= line && hunk.getBoundingClientRect().bottom > 0) ?? hunks[0];
}

// The next one below the landing line, or the previous one above it (the start of the current one when it is
// scrolled part way).
export function step(elements: HTMLElement[], direction: 1 | -1) {
  if (direction === 1) {
    return elements.find(element => top(element) > LANDING + 4);
  }
  return elements.findLast(element => top(element) < LANDING - 4);
}

export function land(element: HTMLElement, marked = true) {
  settleLayout();
  window.scrollTo({ top: window.scrollY + top(element) - LANDING, behavior: "auto" });
  if (marked) {
    flash(element);
  }
}
