import { ChevronDown } from "lucide-react";
import type { Checks, Layer, Ready } from "shared/payload";
import { LineCountTable } from "src/components/guide/LineCount";
import { useChecks, useConflicts } from "src/components/ready/checks";
import { Badge, type Tone } from "src/components/ui/badge";
import { Button } from "src/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "src/components/ui/popover";
import { useLayer, useReview } from "src/queries/review.query";
import { useViewStore } from "src/store/view.store";
import { reveal } from "src/utils/anchors";
import { cn } from "src/utils/cn";

// id keeps a chip whose words change (CI) the same element, so its colour can change in place; status is CI's.
export type Chip = { tone: "good" | "warn" | "bad"; label: string; title?: string; id?: string; status?: "pending" | "settled" };

const TONES: Record<Chip["tone"], Tone> = { good: "success", warn: "warning", bad: "danger" };
export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function ciChip(checks: Checks): Chip {
  const ci = { id: "ci", status: checks.pending ? "pending" : "settled" } as const;
  if (checks.fail) {
    return { ...ci, tone: "bad", label: `CI: ${checks.fail} failing`, title: checks.failing.map(x => x.name).join(", ") };
  }
  if (checks.expected) {
    return {
      ...ci,
      tone: "warn",
      label: `CI: ${plural(checks.expected, "required check")} not reported`,
      title: "Required by the trunk's rules, and nothing has run them on this head",
    };
  }
  if (checks.cancel) {
    return { ...ci, tone: "warn", label: `CI: ${checks.cancel} cancelled` };
  }
  return checks.pending ? { ...ci, tone: "warn", label: `CI: ${checks.pending} pending` } : { ...ci, tone: "good", label: "CI passing" };
}

const mismatches = (layer: Layer) => (layer.descriptionCheck?.unsupported ?? []).length + (layer.descriptionCheck?.missing ?? []).length;
const asks = (layer: Layer) => (layer.descriptionCheck?.issue ?? []).length;
export const riskySections = (layer: Layer) => layer.sections.filter(section => section.kind === "guide" && section.risk).length;

// How much there is to read: lines outside tests and in tests, each with its files.
function sizeText({ lines, files, tests = 0, testFiles }: Ready) {
  const where = testFiles ? plural(testFiles, "test file") : "tests";
  if (!tests) {
    return `${plural(lines, "line")} in ${plural(files, "file")}`;
  }
  return lines ? `${plural(lines, "line")} in ${plural(files, "file")}, plus ${tests} in ${where}` : `${plural(tests, "line")} in ${where}`;
}

// A layer's lines to read, tests among them, as its picker and its row in the stack say it.
export const toReview = (ready: Ready) => `${plural(ready.lines + (ready.tests ?? 0), "line")} to review`;

// The template's chips, in its order. checks is CI as it stands now; it defaults to what the payload holds.
export function readyChips(layer: Layer, checks: Checks | null = layer.ready?.checks ?? null): Chip[] {
  const { ready, meta, tells, annotations, descriptionCheck } = layer;
  const chips: Chip[] = [];
  if (ready) {
    chips.push({ tone: ready.tone, label: `${sizeText(ready)}: ${ready.band}` });
  }
  if (checks) {
    chips.push(ciChip(checks));
    if (checks.stale) {
      chips.push({ tone: "warn", label: "CI ran on the pushed head, not this one" });
    }
  }
  if (annotations.length) {
    const placed = annotations.filter(a => a.row).length;
    chips.push({
      tone: annotations.some(a => a.level === "failure") ? "bad" : "warn",
      label: placed ? `CI: ${plural(placed, "annotation")} on changed lines` : `CI: ${plural(annotations.length, "annotation")} elsewhere`,
    });
  }
  const last = meta.lastPass;
  if (last) {
    const sha = last.headSha.slice(0, 7);
    chips.push(
      last.fresh
        ? { tone: "warn", label: `${plural(last.fresh, "hunk")} new since ${sha}` }
        : { tone: "good", label: `Nothing new since ${sha}` },
    );
  }
  if (ready?.implChanged && !ready.testsChanged) {
    chips.push({ tone: "warn", label: "No test changes" });
  }
  chips.push(tells.length ? { tone: "warn", label: plural(tells.length, "flagged line") } : { tone: "good", label: "No flagged lines" });
  if (descriptionCheck) {
    const n = mismatches(layer);
    chips.push(
      n
        ? { tone: "warn", label: `Description: ${plural(n, "mismatch", "mismatches")}` }
        : { tone: "good", label: "Description matches the diff" },
    );
    if (asks(layer)) {
      chips.push({ tone: "warn", label: `Issue: ${plural(asks(layer), "ask")} not in the diff` });
    }
  }
  return chips;
}

type Conflicts = { own: boolean; below: number[] };
const NO_CONFLICTS: Conflicts = { own: false, below: [] };

// What GitHub says about merging, which the build can't know: this layer's own conflicts, or a lower layer's.
function conflictChips(layer: Layer, { own, below }: Conflicts): Chip[] {
  if (own) {
    // The branch is named in the tip: a long name made the chip wider than a phone screen.
    return [{ tone: "bad", label: "Conflicts with its base", title: `Conflicts with ${layer.meta.base}` }];
  }
  return below.length ? [{ tone: "warn", label: `${below.map(id => `#${id}`).join(", ")} below has conflicts` }] : [];
}

// The shorter set a layer gets in the stack panel, as the template's layerRow builds it.
export function layerChips(layer: Layer, needsRebase: boolean, checks: Checks | null, conflicts = NO_CONFLICTS): Chip[] {
  const chips: Chip[] = [...conflictChips(layer, conflicts)];
  if (needsRebase) {
    chips.push({ tone: "bad", label: "Needs a rebase", title: "This layer trails the one below it" });
  }
  if (layer.ready) {
    chips.push({ tone: layer.ready.tone, label: toReview(layer.ready) });
  }
  if (checks) {
    chips.push(ciChip(checks));
  }
  if (layer.tells.length) {
    chips.push({ tone: "warn", label: `${layer.tells.length} flagged` });
  }
  if (mismatches(layer)) {
    chips.push({ tone: "warn", label: `Description: ${plural(mismatches(layer), "mismatch", "mismatches")}` });
  }
  if (asks(layer)) {
    chips.push({ tone: "warn", label: `Issue: ${asks(layer)} not in the diff` });
  }
  if (riskySections(layer)) {
    chips.push({ tone: "warn", label: plural(riskySections(layer), "careful read") });
  }
  return chips;
}

export function ChipRow({ chips, small, className }: { chips: Chip[]; small?: boolean; className?: string }) {
  return (
    <span className={cn("flex flex-wrap gap-1.5", small && "gap-1", className)}>
      {chips.map(chip => (
        <Badge
          key={chip.id ?? chip.label}
          tone={TONES[chip.tone]}
          title={chip.title}
          data-status={chip.status}
          className={cn(small && "px-1.5 py-px text-xs", chip.status && "motion-status")}
        >
          {chip.status === "pending" && <span aria-hidden className="motion-pending size-1.5 rounded-full bg-current" />}
          {chip.label}
        </Badge>
      ))}
    </span>
  );
}

// Takes the page to the stack panel on Overview, at the row of the layer being read.
function showStack() {
  useViewStore.getState().setTab("overview");
  const until = performance.now() + 3000;
  const look = () => {
    const row = document.querySelector<HTMLElement>("#stack li:has(> [aria-current])");
    if (row) {
      reveal(row);
    } else if (performance.now() < until) {
      requestAnimationFrame(look);
    }
  };
  requestAnimationFrame(look);
}

// The compact row of size, CI, annotation, what's new, tests, flags and description chips, led on a stack by a
// layer that needs a rebase, which leads to the stack panel.
export function ReadyChips({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const checks = useChecks(shown);
  const conflicts = useConflicts(shown);
  const stack = useReview().data?.stack;
  if (!shown) {
    return null;
  }
  const rebase = Boolean(stack?.layers.find(row => row.number === layer)?.needsRebase);
  return (
    <span className="flex flex-wrap gap-1.5">
      <ChipRow chips={conflictChips(shown, conflicts)} className="contents" />
      {rebase && (
        <button
          type="button"
          onClick={showStack}
          title="This layer trails the one below it. Show the stack"
          className="cursor-pointer rounded-full"
        >
          <Badge tone="danger" className="hover:bg-danger/20">
            Needs a rebase
          </Badge>
        </button>
      )}
      <ChipRow chips={readyChips(shown, checks)} className="contents" />
    </span>
  );
}

// The ready check on the Overview, scrolled into view from wherever the reader is.
function showReadyCheck() {
  useViewStore.getState().setTab("overview");
  const until = performance.now() + 3000;
  const look = () => {
    const region = document.querySelector<HTMLElement>("[aria-label='Before you mark it ready']");
    if (region) {
      region.scrollIntoView({ block: "start" });
    } else if (performance.now() < until) {
      requestAnimationFrame(look);
    }
  };
  requestAnimationFrame(look);
}

// The top bar's one pill for every chip: how many want a look, which opens to the chips themselves.
export function ReadyPill({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const checks = useChecks(shown);
  const conflicts = useConflicts(shown);
  const stack = useReview().data?.stack;
  if (!shown) {
    return null;
  }
  const rebase = Boolean(stack?.layers.find(row => row.number === layer)?.needsRebase);
  const chips = [...conflictChips(shown, conflicts), ...readyChips(shown, checks)];
  const open = chips.filter(chip => chip.tone !== "good");
  const bad = rebase || open.some(chip => chip.tone === "bad");
  const label = open.length + (rebase ? 1 : 0) ? `${open.length + (rebase ? 1 : 0)} to check` : "Nothing to check";
  return (
    <Popover>
      {/* The palette's own surface, with the status as a dot: the signal colours don't follow the palettes. */}
      <PopoverTrigger
        className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 font-medium text-foreground/80 text-xs hover:bg-muted pointer-coarse:min-h-9 pointer-coarse:px-3"
        aria-label={`${label} before it's ready`}
      >
        <span aria-hidden className={cn("size-2 rounded-full", bad ? "bg-danger" : open.length ? "bg-warning" : "bg-success")} />
        {label}
        <ChevronDown aria-hidden className="size-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-[26rem] max-w-[calc(100vw-2rem)] gap-3">
        <ReadyChips layer={layer} />
        <LineCountTable layer={layer} />
        <Button size="sm" variant="outline" className="justify-self-start" onClick={showReadyCheck}>
          Open the ready check
        </Button>
      </PopoverContent>
    </Popover>
  );
}
