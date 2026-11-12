import type { Category, LineCount as Count } from "shared/payload";

import { plural } from "src/components/guide/visible";
import { Popover, PopoverContent, PopoverTrigger } from "src/components/ui/popover";
import { useLayer } from "src/queries/review.query";
import { cn } from "src/utils/cn";

const NAMES: Record<Category, string> = {
  implementation: "Implementation",
  test: "Tests",
  docs: "Documentation",
  generated: "Generated",
  lockfile: "Lock files",
  "agent-guidance": "Agent guidance",
  localization: "Localization",
  assets: "Assets",
};

// The template's counts: only the sides that changed, or ±0.
export function Counts({ add, del }: Count) {
  return (
    <span className="whitespace-nowrap font-mono text-[12.5px] tabular-nums">
      {add > 0 && <span className="text-success">+{add}</span>}
      {add > 0 && del > 0 && " "}
      {del > 0 && <span className="text-danger">−{del}</span>}
      {add === 0 && del === 0 && <span>±0</span>}
    </span>
  );
}

// The headline: implementation lines without formatting noise, like Linear's. (*) opens every category and the total.
export function LineCount({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  if (!shown) {
    return null;
  }
  const { stats } = shown;
  const impl = stats.categories.implementation ?? { add: 0, del: 0, files: 0 };
  const differs = impl.add !== stats.total.add || impl.del !== stats.total.del;
  const rows = (Object.entries(stats.categories) as [Category, Count & { files: number }][]).sort(([a], [b]) =>
    a === "implementation" ? -1 : b === "implementation" ? 1 : 0,
  );
  const files = "whitespace-nowrap py-0.5 pl-4 text-muted-foreground text-xs";
  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 hover:bg-muted"
        aria-label="Line counts by kind of file"
      >
        <Counts add={impl.add} del={impl.del} />
        {differs && <span className="font-mono text-[11px] text-muted-foreground">(*)</span>}
      </PopoverTrigger>
      <PopoverContent className="w-[19rem]">
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {rows.map(([category, count]) => (
              <tr key={category}>
                <td className="py-0.5">{NAMES[category] ?? category}</td>
                <td className={files}>{plural(count.files, "file")}</td>
                <td className="py-0.5 pl-4 text-right">
                  <Counts add={count.add} del={count.del} />
                </td>
              </tr>
            ))}
            {(stats.noise.add > 0 || stats.noise.del > 0) && (
              <tr>
                <td className="py-0.5" colSpan={2}>
                  Formatting only
                </td>
                <td className="py-0.5 pl-4 text-right">
                  <Counts add={stats.noise.add} del={stats.noise.del} />
                </td>
              </tr>
            )}
            <tr className="border-t font-semibold">
              <td className="pt-1.5">Total</td>
              <td className={cn(files, "pt-1.5 font-normal")}>{plural(stats.total.files, "file")}</td>
              <td className="pt-1.5 pl-4 text-right">
                <Counts add={stats.total.add} del={stats.total.del} />
              </td>
            </tr>
          </tbody>
        </table>
        {stats.moved > 0 && <p className="mt-2 text-muted-foreground text-xs">{plural(stats.moved, "added line")} only moved.</p>}
      </PopoverContent>
    </Popover>
  );
}
