import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HTTPError } from "ky";
import type { Message, NewMessage } from "shared/messages";
import type { DismissReason, ReviewEffort } from "shared/reviews";

import { api } from "src/queries/api";

function useMessagesMutation<Input, Output>(mutationFn: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages"] }) });
}

// What the server said went wrong, or a plain sentence when it said nothing.
export function errorText(error: unknown, fallback = "That didn't work. Try again.") {
  if (error instanceof HTTPError && error.data && typeof error.data === "object" && "error" in error.data) {
    return String(error.data.error);
  }
  return fallback;
}

export const useAddMessage = () => useMessagesMutation((message: NewMessage) => api.post("messages", { json: message }).json<Message>());

export const useEditDraft = () =>
  useMessagesMutation(({ id, text }: { id: string; text: string }) => api.patch(`messages/${id}`, { json: { text } }).json<Message>());

export const useArchiveThread = () =>
  useMessagesMutation(({ id, ...body }: { id: string; archived: boolean; reason?: DismissReason }) =>
    api.post(`messages/${id}/archive`, { json: body }).json<Message>(),
  );

export const useMarkSeen = () => useMessagesMutation((id: string) => api.post(`messages/${id}/seen`).json<Message>());

export const useRequestReview = () =>
  useMessagesMutation((request: { layer: number; effort: ReviewEffort }) => api.post("reviews", { json: request }).json<Message>());

export const useArchiveReview = () => useMessagesMutation((n: number) => api.post(`reviews/${n}/archive`).json());

export const useFixRecommended = () => useMessagesMutation((n: number) => api.post(`reviews/${n}/fix`).json<{ sent: number }>());

export const useDeleteDraft = () => useMessagesMutation((id: string) => api.delete(`messages/${id}`).json());

export const useSendDrafts = () => useMessagesMutation<void, { sent: number; listening: boolean }>(() => api.post("messages/send").json());
