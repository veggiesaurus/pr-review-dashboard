import { useQueries } from "@tanstack/react-query";
import type { GithubLive } from "shared/live";
import type { Checks, Layer } from "shared/payload";

import { fetchGithub, useGithub } from "src/queries/live.query";
import { useReview } from "src/queries/review.query";

// The same counts collect.py makes from `gh pr checks`, from what GitHub says now. No checks at all is no chip.
export function liveChecks(live: GithubLive): Checks | null {
  if (!live.pr || live.checks.length === 0) {
    return null;
  }
  const count = (bucket: string) => live.checks.filter(check => check.bucket === bucket).length;
  return {
    pass: count("pass"),
    fail: count("fail"),
    pending: count("pending"),
    cancel: count("cancel"),
    expected: count("expected"),
    failing: live.checks.filter(check => check.bucket === "fail").map(({ name, link }) => ({ name, link })),
    stale: live.pr.moved,
  };
}

// CI as GitHub reports it now, or as it was when the review was built when GitHub can't be asked.
export function useChecks(layer: Layer | undefined): Checks | null {
  const enabled = layer?.capabilities.github ?? false;
  const live = useGithub(layer?.id ?? 0, enabled).data;
  if (!layer) {
    return null;
  }
  if (enabled && live?.pr && !live.error) {
    return liveChecks(live);
  }
  return layer.ready?.checks ?? null;
}

const conflicting = (live: GithubLive | undefined) =>
  Boolean(live?.pr && live.pr.state === "OPEN" && (live.pr.mergeable === "CONFLICTING" || live.pr.mergeState === "DIRTY"));

// Whether GitHub says this layer conflicts with its base, and which layers under it do: GitHub can't say whether a
// layer merges while one below it doesn't.
export function useConflicts(layer: Layer | undefined): { own: boolean; below: number[] } {
  const layers = useReview().data?.layers ?? [];
  const upTo = layers.slice(0, layers.findIndex(item => item.id === layer?.id) + 1).filter(item => item.capabilities.github);
  const live = useQueries({
    queries: upTo.map(item => ({ queryKey: ["github", item.id], queryFn: () => fetchGithub(item.id), staleTime: 10_000 })),
  });
  const hit = upTo.filter((_, index) => conflicting(live[index]?.data)).map(item => item.id);
  return { own: hit.includes(layer?.id ?? -1), below: hit.filter(id => id !== layer?.id) };
}
