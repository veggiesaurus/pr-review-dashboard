import { useMemo, useState } from "react";

import { pad2, splitPath } from "src/components/guide/visible";
import { Usages } from "src/components/live/Usages";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "src/components/ui/dialog";
import { useLayer } from "src/queries/review.query";
import { useViewStore } from "src/store/view.store";
import { cn } from "src/utils/cn";

type Item = { target: string; label: string; detail: string };

// Linear's Go to file and Go to Guide section: type part of a path or title, then Enter. u opens it on where a name is used.
export function JumpTo({ layer }: { layer: number }) {
  const mode = useViewStore(state => state.jump);
  const setJump = useViewStore(state => state.setJump);
  const goTo = useViewStore(state => state.goTo);
  const shown = useLayer(layer);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const items = useMemo<Item[]>(() => {
    if (!shown) {
      return [];
    }
    if (mode === "section") {
      return shown.sections.map((section, index) => ({
        target: `s${index + 1}`,
        label: section.title,
        detail: section.kind === "guide" ? pad2(index + 1) : "·",
      }));
    }
    return [...shown.files]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(file => {
        const { name, dir } = splitPath(file.path);
        return { target: file.id, label: name, detail: dir };
      });
  }, [shown, mode]);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = items.filter(item => terms.every(term => `${item.detail}/${item.label}`.toLowerCase().includes(term)));
  const chosen = Math.min(at, Math.max(found.length - 1, 0));

  const close = () => {
    setJump(null);
    setQuery("");
    setAt(0);
  };
  const choose = (item: Item | undefined) => {
    if (item) {
      close();
      goTo(layer, item.target);
    }
  };
  const what = mode === "section" ? "section" : "file";
  const content = "top-[12vh] max-w-xl translate-y-0 gap-3 p-4";

  if (mode === "usages") {
    return (
      <Dialog open onOpenChange={open => !open && close()}>
        <DialogContent className={content}>
          <Usages layer={layer} onJump={close} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={mode !== null} onOpenChange={open => !open && close()}>
      <DialogContent className={content}>
        <DialogTitle className="text-lg">Go to a {what}</DialogTitle>
        <DialogDescription className="sr-only">
          Type part of its {mode === "section" ? "title" : "path"}, then press Enter.
        </DialogDescription>
        <input
          autoFocus
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            setAt(0);
          }}
          onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setAt(Math.max(0, Math.min(found.length - 1, chosen + (event.key === "ArrowDown" ? 1 : -1))));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(found[chosen]);
            }
          }}
          placeholder={mode === "section" ? "Section title" : "File path"}
          aria-label={`Find a ${what}`}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
        />
        <ul aria-label={`${what}s`} className="max-h-[50vh] overflow-y-auto">
          {found.length === 0 && <li className="px-2 py-1.5 text-muted-foreground text-sm">Nothing matches.</li>}
          {found.map((item, index) => (
            <li key={item.target}>
              <button
                type="button"
                aria-current={index === chosen ? "true" : undefined}
                ref={index === chosen ? element => element?.scrollIntoView({ block: "nearest" }) : undefined}
                onClick={() => choose(item)}
                onMouseMove={() => setAt(index)}
                className={cn(
                  "flex w-full cursor-pointer items-baseline gap-2 truncate rounded-md px-2 py-1.5 text-left text-sm",
                  index === chosen && "bg-muted",
                )}
              >
                {mode === "section" && <span className="font-mono text-muted-foreground text-xs">{item.detail}</span>}
                <span className="font-medium">{item.label}</span>
                {mode !== "section" && item.detail && <span className="truncate text-muted-foreground text-xs">{item.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
