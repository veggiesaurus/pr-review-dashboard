import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ShareInfo, SignInStatus, SignInWith } from "shared/messages";

import { api } from "src/queries/api";

export const useShare = () => useQuery({ queryKey: ["share"], queryFn: () => api.get("share").json<ShareInfo>() });

function useShareMutation(method: "post" | "delete") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api[method]("share").json<ShareInfo>(),
    onSuccess: data => {
      queryClient.setQueryData(["share"], data);
      return queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export const useStartShare = () => useShareMutation("post");
export const useStopShare = () => useShareMutation("delete");

export function useAnswerGuest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, allow }: { id: string; allow: boolean }) => api.post(`share/guests/${id}`, { json: { allow } }).json<ShareInfo>(),
    onSuccess: data => queryClient.setQueryData(["share"], data),
  });
}

export const useSignInWith = () => useQuery({ queryKey: ["signin-with"], queryFn: () => api.get("signin").json<{ with: SignInWith }>() });

// A name only when guests sign in with one; GitHub's sign-in takes nothing.
export const useStartSignIn = () =>
  useMutation({
    mutationFn: (name?: string) => api.post("signin", name === undefined ? {} : { json: { name } }).json<{ id: string } & SignInStatus>(),
  });

// Asked every couple of seconds until the server has an answer: the server polls GitHub itself.
export const useSignInStatus = (id: string | undefined) =>
  useQuery({
    queryKey: ["signin", id],
    queryFn: () => api.get(`signin/${id}`).json<SignInStatus>(),
    enabled: id !== undefined,
    refetchInterval: query => (query.state.data?.state === "pending" || query.state.data?.state === "waiting" ? 2000 : false),
    // The guest is usually on GitHub's tab, or in chat with the owner, while this waits.
    refetchIntervalInBackground: true,
  });
