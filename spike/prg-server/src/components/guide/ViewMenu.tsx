import { type ReactNode, useMemo } from "react";

import { plural, shownFiles, shownSections } from "src/components/guide/visible";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "src/components/ui/select";
import { useCommits } from "src/queries/live.query";
import { useLayer } from "src/queries/review.query";
import { type Show, useViewStore } from "src/store/view.store";
import { cn } from "src/utils/cn";
import { ago, fullDate } from "src/utils/dates";

const showValue = (show: Show) => (show.kind === "commit" ? `c${show.index}` : show.kind);

function parseShow(value: string): Show {
  if (value === "fresh") {
    return { kind: "fresh" };
  }
  return value.startsWith("c") ? { kind: "commit", index: Number(value.slice(1)) } : { kind: "all" };
}

function Detail({ children }: { children: ReactNode }) {
  return <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground text-xs">{children}</span>;
}

// The template's menu: everything, what is new since the last build when there was one, and each commit when
// collect.py mapped them (it stops past 150 files). It isn't offered when there is nothing to choose. The payload
// has each commit's message and hunks; who wrote it, when and how big it is come from git, and are left out if
// the clone can't say.
function ShowMenu({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const show = useViewStore(state => state.show);
  const formatting = useViewStore(state => state.formatting);
  const setShow = useViewStore(state => state.setShow);
  const meta = shown?.meta;
  const mapped = Boolean(meta?.commitMap && meta.commits.length);
  const { data } = useCommits(layer, meta?.headSha ?? "", mapped);
  const commits = useMemo(() => {
    if (!shown || !mapped) {
      return [];
    }
    const details = new Map(data?.commits.map(commit => [commit.sha, commit]));
    return shown.meta.commits.map((message, index) => {
      const [first = "", ...rest] = message.split("\n");
      const sha = shown.meta.shas[index] ?? "";
      const files = shownFiles(shown, { kind: "commit", index }, formatting);
      return {
        value: `c${index}`,
        sha: sha.slice(0, 7) || first.split(" ")[0] || "",
        subject: first.replace(/^[0-9a-f]{7,} /, ""),
        body: rest.join(" ").trim(),
        detail: details.get(sha),
        hunks: files.reduce((n, file) => n + file.hit.length, 0),
        files: files.length,
      };
    });
  }, [shown, mapped, data, formatting]);
  if (!meta || !(meta.lastPass || mapped)) {
    return null;
  }
  const last = meta.lastPass;
  const picked = show.kind === "commit" ? commits[show.index] : null;
  return (
    <Select value={showValue(show)} onValueChange={value => setShow(parseShow(value))}>
      <SelectTrigger aria-label="Which part of the change to show" className="max-w-[22rem]">
        <SelectValue>
          <span className="flex min-w-0 items-baseline gap-1.5">
            {picked && <span className="shrink-0 font-mono text-muted-foreground text-xs">{picked.sha}</span>}
            <span className="truncate">
              {picked ? picked.subject : show.kind === "fresh" && last ? `New since ${last.headSha.slice(0, 7)}` : "All changes"}
            </span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="w-[30rem]">
        <SelectItem value="all" label="All changes">
          <Detail>
            {plural(meta.commits.length, "commit")}, {plural(shown.files.length, "file")}
          </Detail>
        </SelectItem>
        {last && (
          <SelectItem value="fresh" label={`New since ${last.headSha.slice(0, 7)}`}>
            <Detail>
              {last.at && <span title={fullDate(last.at)}>Built {ago(last.at)}</span>}
              <span>{plural(last.fresh, "hunk")} since</span>
            </Detail>
          </SelectItem>
        )}
        {commits.length > 0 && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>One commit, oldest first</SelectLabel>
              {commits.map(commit => (
                <SelectItem key={commit.value} value={commit.value} label={commit.subject}>
                  {commit.body && <span className="line-clamp-2 text-[13px] text-muted-foreground">{commit.body}</span>}
                  <Detail>
                    <span className="font-mono">{commit.sha}</span>
                    {commit.detail && (
                      <>
                        <span>{commit.detail.author}</span>
                        <span title={fullDate(commit.detail.at)}>{ago(commit.detail.at)}</span>
                        <span className="font-mono">
                          <span className="text-success">+{commit.detail.add}</span>{" "}
                          <span className="text-danger">−{commit.detail.del}</span>
                        </span>
                      </>
                    )}
                    <span>
                      {plural(commit.hunks, "hunk")} in {plural(commit.files, "file")}
                    </span>
                  </Detail>
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
      </SelectContent>
    </Select>
  );
}

// Layout, formatting and which part of the change to show, as siblings in the header's toolbar so they wrap with it.
// The choices are in the view store; drawing them is the diff's.
export function ViewMenu({ layer }: { layer: number }) {
  const { layout, formatting, setLayout, setFormatting } = useViewStore();
  const segment = (value: "unified" | "split", label: string) => (
    <button
      type="button"
      aria-pressed={layout === value}
      onClick={() => setLayout(value)}
      className={cn(
        "cursor-pointer px-2.5 py-0.5",
        layout === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <>
      <ShowMenu layer={layer} />
      {/* Below 860px the page stays unified, as the template's does. */}
      <fieldset aria-label="Diff layout" className="hidden overflow-hidden rounded-full border min-[861px]:inline-flex">
        {segment("unified", "Unified")}
        {segment("split", "Split")}
      </fieldset>
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-muted-foreground" title="Show formatting-only changes, dimmed">
        <input type="checkbox" checked={formatting} onChange={event => setFormatting(event.target.checked)} className="accent-primary" />
        Formatting
      </label>
    </>
  );
}

// "Showing N hunks in M files" while a filter is on, counted over the cards the tab draws.
export function FilterNote({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const tab = useViewStore(state => state.tab);
  const show = useViewStore(state => state.show);
  const formatting = useViewStore(state => state.formatting);
  const setShow = useViewStore(state => state.setShow);
  const counts = useMemo(() => {
    if (!shown || show.kind === "all") {
      return null;
    }
    if (tab === "diff" || !shown.sections.length) {
      const files = shownFiles(shown, show, formatting);
      return { hunks: files.reduce((n, file) => n + file.hit.length, 0), files: files.length };
    }
    const parts = shownSections(shown, show, formatting).flatMap(section => section.parts);
    return { hunks: parts.reduce((n, part) => n + part.hit.length, 0), files: parts.length };
  }, [shown, tab, show, formatting]);
  if (!counts) {
    return null;
  }
  return (
    <p className="text-[13px] text-muted-foreground" role="status">
      Showing {plural(counts.hunks, "hunk")} in {plural(counts.files, "file")}.{" "}
      <button
        type="button"
        onClick={() => setShow({ kind: "all" })}
        className="cursor-pointer text-primary underline underline-offset-3 hover:decoration-2"
      >
        Show everything
      </button>
    </p>
  );
}
