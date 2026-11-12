import { useEffect } from "react";
import type { ReviewResponse } from "shared/payload";

import { useViewStore } from "src/store/view.store";
import { formatHash, parseHash } from "src/utils/anchors";
import { defaultLayer } from "src/utils/payload";

// The layer, the tab and the last file or line jumped to live in the hash, so a reload stays put and the address can be shared.
export function useHashSync(review: ReviewResponse | undefined) {
  useEffect(() => {
    if (!review) {
      return;
    }
    const { layer, setLayer, setTab, goTo, setReview } = useViewStore.getState();
    setReview(review);
    const ids = review.layers.map(l => l.id);
    if (layer !== null) {
      if (!ids.includes(layer)) {
        setLayer(defaultLayer(review));
      }
      return;
    }
    const hash = parseHash(location.hash);
    setLayer(hash.layer !== undefined && ids.includes(hash.layer) ? hash.layer : defaultLayer(review));
    if (hash.tab) {
      setTab(hash.tab);
    }
    if (hash.target) {
      goTo(hash.layer ?? null, hash.target, hash.section);
    }
  }, [review]);

  useEffect(
    () =>
      useViewStore.subscribe(({ layer, tab, anchor }) => {
        const hash = formatHash(layer ?? 0, tab, anchor);
        if (layer !== null && location.hash !== hash) {
          try {
            // Each move is an entry, so Back returns to the layer, tab or file before it. The first one only names where the page opened.
            history[location.hash ? "pushState" : "replaceState"](null, "", hash);
          } catch {
            // History can be blocked; the view still changes.
          }
        }
      }),
    [],
  );

  useEffect(() => {
    const follow = () => {
      const hash = parseHash(location.hash);
      const { setLayer, setTab, goTo } = useViewStore.getState();
      if (hash.layer !== undefined) {
        setLayer(hash.layer);
      }
      if (hash.tab) {
        setTab(hash.tab);
      }
      if (hash.target) {
        goTo(hash.layer ?? null, hash.target, hash.section);
      }
    };
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
}
