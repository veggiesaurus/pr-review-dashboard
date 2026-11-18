import { useQuery } from "@tanstack/react-query";
import type { Person } from "shared/messages";

import { api } from "src/queries/api";

const NONE: Person[] = [];

// The owner, when known, and the guests signed in: everyone a message can mention.
export const usePeople = () =>
  useQuery({ queryKey: ["people"], queryFn: () => api.get("people").json<Person[]>(), staleTime: Number.POSITIVE_INFINITY }).data ?? NONE;
