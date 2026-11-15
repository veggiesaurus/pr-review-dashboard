import { useQuery } from "@tanstack/react-query";
import type { Me } from "shared/messages";

import { api } from "src/queries/api";

export const useMe = () =>
  useQuery({ queryKey: ["me"], queryFn: () => api.get("me").json<Me>(), staleTime: Number.POSITIVE_INFINITY }).data;

// Only the owner is let see or change what the session's guests may not; until the page knows, nothing shows.
export const useIsOwner = () => useMe()?.role === "owner";
