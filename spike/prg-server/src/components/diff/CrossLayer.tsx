import { Fragment, useMemo } from "react";
import type { ReviewResponse } from "shared/payload";
import { FullRow } from "src/components/diff/Rows";
import { useReview } from "src/queries/review.query";
import { useViewStore } from "src/store/view.store";
import { indexLayer } from "src/utils/payload";

// A name this hunk shares with another layer: up when this hunk defines it and a later layer uses it.
export type CrossLink = { name: string; up: boolean; refs: string[] };

const NONE = new Map<string, CrossLink[]>();
const SHOWN = 8;
const pad = (n: number) => String(n).padStart(2, "0");

// The stack's cross-layer links for one layer, by hunk id.
export function useCrossLinks(layer: number) {
  const links = useReview().data?.stack?.links;
  return useMemo(() => {
    if (!links?.length) {
      return NONE;
    }
    const out = new Map<string, CrossLink[]>();
    const add = (hunk: string, link: CrossLink) => out.set(hunk, [...(out.get(hunk) ?? []), link]);
    for (const link of links) {
      const [from, hunk] = link.from.split(":");
      if (Number(from) === layer && hunk) {
        add(hunk, { name: link.name, up: true, refs: link.usedIn });
      }
      for (const use of link.usedIn) {
        const [at, used] = use.split(":");
        if (Number(at) === layer && used) {
          add(used, { name: link.name, up: false, refs: [link.from] });
        }
      }
    }
    return out;
  }, [links, layer]);
}

// One link per layer and section, "#1014 §05", titled with the section and the file.
function refLinks(review: ReviewResponse | undefined, refs: string[]) {
  const seen = new Map<string, { ref: string; title: string }>();
  for (const ref of refs) {
    const [n, hunk = ""] = ref.split(":");
    const layer = review?.layers.find(l => l.id === Number(n));
    const index = layer ? indexLayer(layer) : null;
    const at = index?.owner.get(hunk);
    const section = at === undefined ? undefined : layer?.sections[at];
    const label = `#${n} ${section?.kind === "guide" && at !== undefined ? `§${pad(at + 1)}` : hunk}`;
    if (!seen.has(label)) {
      const path = index?.hunks.get(hunk)?.file.path;
      seen.set(label, { ref, title: [section?.title, path].filter(Boolean).join(", ") });
    }
  }
  return [...seen];
}

// The row under a hunk naming what it shares with other layers of the stack, each linking there.
export function CrossLayerRow({ links }: { links: CrossLink[] }) {
  const review = useReview().data;
  const goTo = useViewStore(state => state.goTo);
  const part = (up: boolean, label: string) => {
    const mine = links.filter(link => link.up === up);
    if (!mine.length) {
      return null;
    }
    return (
      <div>
        {label}{" "}
        {mine.slice(0, SHOWN).map((link, k) => (
          <Fragment key={`${link.name}:${link.refs.join(",")}`}>
            {k > 0 && "; "}
            <code className="font-mono text-foreground">{link.name}</code>{" "}
            {refLinks(review, link.refs).map(([text, { ref, title }], j) => (
              <Fragment key={ref}>
                {j > 0 && ", "}
                <button
                  type="button"
                  title={title}
                  onClick={() => goTo(null, ref)}
                  className="cursor-pointer underline decoration-dotted underline-offset-3 hover:text-primary"
                >
                  {text}
                </button>
              </Fragment>
            ))}
          </Fragment>
        ))}
        {mine.length > SHOWN && `; and ${mine.length - SHOWN} more`}
      </div>
    );
  };
  return (
    <FullRow className="border-t border-dashed bg-muted px-2.5 py-1 text-[12.5px] text-muted-foreground">
      {part(true, "Used further up the stack:")}
      {part(false, "Defined further down the stack:")}
    </FullRow>
  );
}
