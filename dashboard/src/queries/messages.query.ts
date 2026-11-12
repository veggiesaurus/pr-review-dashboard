import { useQuery } from "@tanstack/react-query";
import type { Message, SessionInfo } from "shared/messages";

import { api } from "src/queries/api";

export const useMessages = () => useQuery({ queryKey: ["messages"], queryFn: () => api.get("messages").json<Message[]>() });

export const useSession = () => useQuery({ queryKey: ["session"], queryFn: () => api.get("session").json<SessionInfo>() });
