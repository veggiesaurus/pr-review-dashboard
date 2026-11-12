import { TriangleAlert } from "lucide-react";

import { useReview } from "src/queries/review.query";
import { useViewStore } from "src/store/view.store";

// When render.py failed every tab says so near the top, with its message: the page then has the diff and nothing else.
export function RenderError() {
  const message = useReview().data?.renderError;
  const tab = useViewStore(state => state.tab);
  const setTab = useViewStore(state => state.setTab);
  if (!message) {
    return null;
  }
  return (
    <div role="alert" className="mt-4 rounded-lg border border-warning/60 bg-warning/10 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4 shrink-0 text-warning" />
        There's no guide for this review yet: render.py couldn't build one, so the page has the diff alone.
      </p>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]">{message}</pre>
      <p className="mt-2 text-foreground/75">
        Ask Claude to build the guide; the page picks it up when it reloads.
        {tab !== "diff" && (
          <>
            {" "}
            <button
              type="button"
              onClick={() => setTab("diff")}
              className="cursor-pointer text-primary underline underline-offset-3 hover:decoration-2"
            >
              Open the Diff tab
            </button>{" "}
            for every file.
          </>
        )}
      </p>
    </div>
  );
}
