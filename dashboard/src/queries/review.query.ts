import { useQuery } from "@tanstack/react-query";
import type { Layer, ReviewResponse } from "shared/payload";

import { api } from "src/queries/api";

export const useReview = () => useQuery({ queryKey: ["review"], queryFn: () => api.get("review").json<ReviewResponse>() });

export function useLayer(id: number | null): Layer | undefined {
  return useReview().data?.layers.find(layer => layer.id === id);
}
