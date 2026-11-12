import { useQuery } from "@tanstack/react-query";
import type { LocalChanges } from "shared/local";

import { api } from "src/queries/api";

// What the checkout has that the reviewed pull request doesn't, asked again every few seconds while the page is in
// view, so a line Claude has just changed gets its preview button without a reload.
export const useLocalChanges = (layer: number) =>
  useQuery({ queryKey: ["local", layer], queryFn: () => api.get(`layers/${layer}/local`).json<LocalChanges>(), refetchInterval: 8000 });
