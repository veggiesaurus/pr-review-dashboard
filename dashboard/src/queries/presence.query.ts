import { useQuery } from "@tanstack/react-query";
import type { Me, PresenceEntry } from "shared/messages";
import { api } from "src/queries/api";

const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api.get("me").json<Me>(), staleTime: Number.POSITIVE_INFINITY });

// Everyone with the review open but this reader. Without a known person of its own, an owner sees everyone.
export function usePresenceList(): PresenceEntry[] {
  const me = useMe().data?.person?.id;
  const { data = [] } = useQuery({ queryKey: ["presence"], queryFn: () => api.get("presence").json<PresenceEntry[]>() });
  return data.filter(entry => entry.person.id !== me);
}
