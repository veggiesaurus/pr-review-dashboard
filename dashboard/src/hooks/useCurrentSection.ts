import { useEffect, useState } from "react";

import { currentSection, sectionElements } from "src/components/guide/nav";
import type { ShownSection } from "src/components/guide/visible";

// The section being read, by data-section index, updated as the page scrolls.
export function useCurrentSection(sections: ShownSection[]) {
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    if (!sections.length) {
      setAt(null);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const element = currentSection(sectionElements());
      setAt(element ? Number(element.dataset.section) : null);
    };
    const later = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", later);
      window.removeEventListener("resize", later);
    };
  }, [sections]);
  return at;
}
