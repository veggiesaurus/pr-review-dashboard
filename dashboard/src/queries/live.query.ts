import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AllowedRefs, CiNotify, CommitsResponse, GithubLive, GithubRefResponse, LinearResponse, UsagesResponse } from "shared/live";
import { type Ref, refId } from "shared/refs";

import { api } from "src/queries/api";

export const fetchGithub = (layer: number, fresh = false) =>
  api.get(`layers/${layer}/github`, { searchParams: fresh ? { fresh: 1 } : {} }).json<GithubLive>();

// The server polls GitHub while the page is open and says over the socket when something changed.
export const useGithub = (layer: number, enabled: boolean) =>
  useQuery({ queryKey: ["github", layer], queryFn: () => fetchGithub(layer), enabled, staleTime: 10_000 });

export const useCiNotify = () => useQuery({ queryKey: ["github", "notify"], queryFn: () => api.get("github/notify").json<CiNotify>() });

export function useSetCiNotify() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => api.put("github/notify", { json: { on } }).json<CiNotify>(),
    onSuccess: data => queryClient.setQueryData(["github", "notify"], data),
  });
}

// The references the server answers for. Anything else in the text shows as written.
export const useAllowedRefs = () =>
  useQuery({
    queryKey: ["refs"],
    queryFn: () => api.get("refs").json<AllowedRefs>(),
    staleTime: Number.POSITIVE_INFINITY,
    select: data => new Set([...data.linear, ...data.github]),
  });

export function useAllowed(ref: Ref): boolean {
  return useAllowedRefs().data?.has(refId(ref)) ?? false;
}

export const useGithubRef = (ref: Exclude<Ref, { kind: "linear" }>, enabled: boolean) =>
  useQuery({
    queryKey: ["github", "ref", refId(ref)],
    queryFn: () =>
      api.get(`github/${ref.repo}/${ref.kind === "github" ? `issues/${ref.number}` : `commits/${ref.sha}`}`).json<GithubRefResponse>(),
    enabled,
    staleTime: 300_000,
  });

export const useLinearIssue = (key: string, enabled: boolean) =>
  useQuery({
    queryKey: ["linear", key],
    queryFn: () => api.get(`linear/${key}`).json<LinearResponse>(),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });

export const useUsages = (layer: number, query: string) =>
  useQuery({
    queryKey: ["usages", layer, query],
    queryFn: () => api.get(`layers/${layer}/usages`, { searchParams: { q: query } }).json<UsagesResponse>(),
    enabled: query !== "",
    staleTime: Number.POSITIVE_INFINITY,
  });

// Keyed by the head too, so a rebuild with new commits asks again.
export const useCommits = (layer: number, head: string, enabled: boolean) =>
  useQuery({
    queryKey: ["commits", layer, head],
    queryFn: () => api.get(`layers/${layer}/commits`).json<CommitsResponse>(),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
