import { NotesPanel } from "src/components/chat/NotesPanel";
import { Markdown } from "src/components/links/Markdown";
import { LivePanel } from "src/components/live/LivePanel";
import { PersonaSummary } from "src/components/overview/PersonaSummary";
import { PrDetails } from "src/components/overview/PrDetails";
import { ReadyCheck } from "src/components/ready/ReadyCheck";
import { StackPanel } from "src/components/stack/StackPanel";
import { useLayer } from "src/queries/review.query";

// The Overview tab: the PR's details, what it does at each technical level and its description, what to settle before marking it ready, the stack, what is
// live on GitHub and Linear, and the user's notes.
export function Overview({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  if (!shown) {
    return null;
  }
  return (
    <div className="mt-6 grid gap-8">
      <StackPanel />
      <PrDetails layer={shown} />
      {shown.summary && <PersonaSummary summary={shown.summary} personas={shown.personas} layer={layer} />}
      {/* Set apart as the author's own words. No heading: PR templates usually open with one. */}
      <section className="rounded-lg border bg-card px-4 py-3 shadow-xs" aria-label="Description">
        {shown.meta.body.trim() ? (
          <Markdown source={shown.meta.body} layer={layer} />
        ) : (
          <p className="text-muted-foreground text-sm">No description.</p>
        )}
      </section>
      <ReadyCheck layer={layer} />
      <LivePanel layer={layer} />
      <NotesPanel />
    </div>
  );
}
