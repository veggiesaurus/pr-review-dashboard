import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PermissionsInfo } from "shared/messages";

import { api } from "src/queries/api";
import { useIsOwner } from "src/queries/me.query";

// Only the owner is sent a prompt's content.
export const usePermissions = () => {
  const owner = useIsOwner();
  return useQuery({ queryKey: ["permissions"], queryFn: () => api.get("permissions").json<PermissionsInfo>(), enabled: owner }).data;
};

export function useAnswerPermission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, behavior }: { id: string; behavior: "allow" | "deny" }) =>
      api.post(`permissions/${id}`, { json: { behavior } }).json<PermissionsInfo>(),
    onSuccess: data => queryClient.setQueryData(["permissions"], data),
    // A prompt that has gone is dropped from the list rather than left with its error.
    onError: () => queryClient.invalidateQueries({ queryKey: ["permissions"] }),
  });
}
