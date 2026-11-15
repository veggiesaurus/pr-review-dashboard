import { useQuery } from "@tanstack/react-query";
import type { PresenceEntry } from "shared/messages";
import { api } from "src/queries/api";
import { useMe } from "src/queries/me.query";

// Everyone with the review open but this reader. Without a known person of its own, an owner sees everyone.
export function usePresenceList(): PresenceEntry[] {
  const me = useMe()?.person?.id;
  const { data = [] } = useQuery({ queryKey: ["presence"], queryFn: () => api.get("presence").json<PresenceEntry[]>() });
  return data.filter(entry => entry.person.id !== me);
}
