import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CommentsResponse, PostPreview, PostRequest, PostResult, PreviewRequest } from "shared/comments";

import { api } from "src/queries/api";

// The pull request's own review threads, read by the server through gh and kept a minute.
export const useComments = (layer: number, enabled: boolean) =>
  useQuery({
    queryKey: ["comments", layer],
    queryFn: () => api.get(`layers/${layer}/comments`).json<CommentsResponse>(),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

export const usePreviewReview = (layer: number) =>
  useMutation({
    mutationFn: (request: PreviewRequest) => api.post(`layers/${layer}/comments/preview`, { json: request }).json<PostPreview>(),
  });

export function usePostReview(layer: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: PostRequest) => api.post(`layers/${layer}/comments/post`, { json: request, timeout: 45_000 }).json<PostResult>(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      void queryClient.invalidateQueries({ queryKey: ["comments", layer] });
    },
  });
}
