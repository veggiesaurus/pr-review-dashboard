const loadedAt = Date.now();

// A message that came in while the page was open, in the last few seconds: a thread drawn again later (another tab, the
// drawer reopened) doesn't play its arrival twice.
export function arrived(at: string) {
  const time = Date.parse(at);
  return time > loadedAt && Date.now() - time < 5000;
}

const LAYOUT = new Set(["motion-grow", "motion-shrink"]);

// Ends the height changes still running, and a panel's entrance, so a jump measures where things will end up. A <details>
// opening or closing isn't in getAnimations(), so its transition is switched off for one style pass instead.
export function settleLayout() {
  const root = document.documentElement;
  root.dataset.motionSettle = "";
  root.getBoundingClientRect();
  delete root.dataset.motionSettle;
  for (const animation of document.getAnimations()) {
    const name = animation instanceof CSSAnimation ? animation.animationName : "";
    const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
    const panel = target instanceof HTMLElement && target.classList.contains("motion-panel");
    if ((LAYOUT.has(name) || panel) && animation.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY) {
      animation.finish();
    }
  }
}
