import { Search } from "lucide-react";
import { type FormEvent, useState } from "react";
import { USAGE_QUERY } from "shared/usage";

import { UsageMatches } from "src/components/diff/UsagesPopover";
import { Button } from "src/components/ui/button";
import { DialogDescription, DialogTitle } from "src/components/ui/dialog";
import { useUsages } from "src/queries/live.query";
import { useLayer } from "src/queries/review.query";

// Where a name you type is used at the head commit: the body of the dialog u opens.
export function Usages({ layer, onJump }: { layer: number; onJump: () => void }) {
  const enabled = useLayer(layer)?.capabilities.usages ?? false;
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const { data, isFetching, error } = useUsages(layer, query);
  const valid = USAGE_QUERY.test(draft.trim());

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) {
      setQuery(draft.trim());
    }
  };

  return (
    <>
      <DialogTitle className="text-lg">Where is it used?</DialogTitle>
      <DialogDescription className="sr-only">Type a name, then press Enter.</DialogDescription>
      {enabled ? (
        <form onSubmit={submit} className="flex gap-2">
          <input
            value={draft}
            onChange={event => setDraft(event.target.value)}
            placeholder="A name, searched across this branch"
            aria-label="Identifier to search for"
            spellCheck={false}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-[13px] placeholder:font-sans placeholder:text-muted-foreground"
          />
          <Button type="submit" variant="outline" disabled={!valid || isFetching}>
            <Search />
            Search
          </Button>
        </form>
      ) : (
        <p className="mt-2 text-muted-foreground text-sm">This review has no commit to search.</p>
      )}

      {(error || data?.error) && <p className="mt-3 text-danger text-sm">{data?.error ?? "The search failed."}</p>}
      {data && !data.error && data.matches.length === 0 && (
        <p className="mt-3 text-muted-foreground text-sm">
          Nothing on this branch uses <code className="font-mono">{query}</code>.
        </p>
      )}
      {data && data.matches.length > 0 && <UsageMatches layer={layer} data={data} onJump={onJump} />}
    </>
  );
}
