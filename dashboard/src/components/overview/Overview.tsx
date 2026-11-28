import { Markdown } from "src/components/links/Markdown";
import { Prose } from "src/components/links/Prose";
import { LivePanel } from "src/components/live/LivePanel";
import { PersonaSummary } from "src/components/overview/PersonaSummary";
import { PrDetails } from "src/components/overview/PrDetails";
import { ReadyCheck } from "src/components/ready/ReadyCheck";
import { StackPanel } from "src/components/stack/StackPanel";
import { useLayer } from "src/queries/review.query";

// The Overview tab: a reading column with the stack, what the PR does, its description and what to settle before
// marking it ready, beside a status column with the PR's facts and what is live on GitHub and Linear.
export function Overview({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  if (!shown) {
    return null;
  }
  return (
    <div className="mt-6 grid max-w-[84rem] items-start gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,46rem)_minmax(20rem,22rem)] lg:justify-between">
      <div className="grid min-w-0 gap-8">
        {/* In full here, since the top bar cuts it to fit. */}
        <h2 className="text-balance font-serif text-3xl leading-tight tracking-tight">
          <Prose text={shown.meta.title || "Untitled review"} layer={layer} />
        </h2>
        <StackPanel />
        {shown.summary && <PersonaSummary summary={shown.summary} personas={shown.personas} layer={layer} />}
        <section className="grid gap-2" aria-label="Description">
          <h2 className="font-medium text-muted-foreground text-sm">Description</h2>
          {/* Set apart as the author's own words, which often open with a heading of their own. */}
          <div className="rounded-lg border bg-card px-4 py-3 shadow-xs">
            {shown.meta.body.trim() ? (
              <Markdown source={shown.meta.body} layer={layer} />
            ) : (
              <p className="text-muted-foreground text-sm">No description.</p>
            )}
          </div>
        </section>
        <ReadyCheck layer={layer} />
      </div>
      {/* Stays in view below the top bar, scrolling on its own when taller than the window. */}
      <aside
        aria-label="Status"
        className="grid min-w-0 gap-4 lg:sticky lg:top-16 lg:-m-1 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto lg:overscroll-contain lg:p-1"
      >
        <PrDetails layer={shown} />
        <LivePanel layer={layer} />
      </aside>
    </div>
  );
}
