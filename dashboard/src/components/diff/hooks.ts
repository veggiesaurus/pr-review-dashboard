import { type RefCallback, useCallback, useState, useSyncExternalStore } from "react";

type Highlighter = typeof import("src/utils/highlight");

let highlighter: Highlighter | null = null;
let loading = false;
const waiting = new Set<() => void>();

function subscribeHighlighter(changed: () => void) {
  waiting.add(changed);
  if (!loading) {
    loading = true;
    import("src/utils/highlight")
      .then(module => {
        highlighter = module;
        for (const notify of waiting) {
          notify();
        }
      })
      .catch(() => {
        // Without the grammars the diff stays plain text.
      });
  }
  return () => {
    waiting.delete(changed);
  };
}

// highlight.js and its grammars, or null until they have loaded.
export const useHighlighter = () => useSyncExternalStore(subscribeHighlighter, () => highlighter);

const WIDE = "(min-width: 861px)";

function subscribeWide(changed: () => void) {
  const query = matchMedia(WIDE);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
}

// Split view needs the room; below 860px the page stays unified, as the template does.
export const useWide = () => useSyncExternalStore(subscribeWide, () => matchMedia(WIDE).matches);

const onNear = new WeakMap<Element, () => void>();
let observer: IntersectionObserver | null = null;

function watch(element: Element, near: () => void) {
  observer ??= new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          onNear.get(entry.target)?.();
        }
      }
    },
    { rootMargin: "800px 0px" },
  );
  onNear.set(element, near);
  observer.observe(element);
  return () => {
    observer?.unobserve(element);
    onNear.delete(element);
  };
}

// True once the element has come within a screen or so of the viewport, and from then on: the expensive parts of a
// diff (highlighting, word marks) wait for it.
export function useNear<T extends Element>(): [RefCallback<T>, boolean] {
  const [near, setNear] = useState(false);
  const ref = useCallback(
    (element: T | null) => {
      if (!element || near) {
        return;
      }
      return watch(element, () => setNear(true));
    },
    [near],
  );
  return [ref, near];
}
