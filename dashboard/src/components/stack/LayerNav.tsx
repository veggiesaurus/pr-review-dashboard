import { plain } from "src/components/guide/visible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "src/components/ui/select";
import { useReview } from "src/queries/review.query";
import { useViewStore } from "src/store/view.store";

// Which layer of the stack is shown, picked from a list of them all, top first.
export function LayerNav() {
  const review = useReview().data;
  const layer = useViewStore(state => state.layer);
  const setLayer = useViewStore(state => state.setLayer);
  if (!review?.stack) {
    return null;
  }
  const { layers, stack } = review;
  const shown = layers.find(item => item.id === layer);
  const summaries = new Map((stack.check?.layers ?? []).map(item => [item.number, item.summary]));
  return (
    <Select value={String(layer ?? "")} onValueChange={value => setLayer(Number(value))}>
      <SelectTrigger aria-label="Layer of the stack" className="max-w-[26rem] text-sm">
        <SelectValue>
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 font-mono text-muted-foreground text-xs">#{layer}</span>
            <span className="truncate">{shown?.meta.title}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="w-[32rem]">
        {[...layers].reverse().map((item, index) => (
          <SelectItem key={item.id} value={String(item.id)} label={`#${item.id} ${item.meta.title}`}>
            {summaries.get(item.id) && (
              <span className="line-clamp-2 text-[13px] text-muted-foreground">{plain(summaries.get(item.id) ?? "")}</span>
            )}
            <span className="flex flex-wrap gap-x-2 text-muted-foreground text-xs">
              <span>
                {layers.length - index} of {layers.length}
                {index === 0 ? ", the top" : index === layers.length - 1 ? `, on ${item.meta.base}` : ""}
              </span>
              {item.ready && <span>{item.ready.lines} lines to review</span>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
