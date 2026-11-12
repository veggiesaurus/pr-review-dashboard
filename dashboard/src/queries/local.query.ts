import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LocalChanges, LocalEdit } from "shared/local";

import { api } from "src/queries/api";

// What the checkout has that the reviewed pull request doesn't, asked again every few seconds while the page is in
// view, so a line Claude has just changed gets its preview button without a reload.
export const useLocalChanges = (layer: number) =>
  useQuery({ queryKey: ["local", layer], queryFn: () => api.get(`layers/${layer}/local`).json<LocalChanges>(), refetchInterval: 8000 });

// Puts the reviewed code back in the checkout at one edit.
export function useRevertLocal(layer: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { file: string; edit: LocalEdit }) => api.post(`layers/${layer}/local/revert`, { json: body }).json(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["local", layer] }),
  });
}
