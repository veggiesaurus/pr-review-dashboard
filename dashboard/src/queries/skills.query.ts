import { useQuery } from "@tanstack/react-query";
import type { Skill } from "shared/messages";

import { api } from "src/queries/api";
import { useIsOwner } from "src/queries/me.query";

const NONE: Skill[] = [];

// The skills the session can run, for the owner's `/` menu; a guest has none to ask for.
export function useSkills() {
  const owner = useIsOwner();
  return (
    useQuery({
      queryKey: ["skills"],
      queryFn: () => api.get("skills").json<Skill[]>(),
      enabled: owner,
      staleTime: Number.POSITIVE_INFINITY,
    }).data ?? NONE
  );
}
