import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Push } from "shared/messages";
import { pageKey } from "src/queries/key";

// Claude's replies can name issues and pull requests, so a new message can widen the references the server answers for.
const KEYS: Record<Push["type"], string[]> = {
  review: ["review", "github", "linear", "usages", "lines", "refs"],
  messages: ["messages", "refs"],
  session: ["session"],
  github: ["github"],
  ticks: ["ticks"],
};

// The server says what changed and the page refetches it, so the socket carries no data of its own.
export function useLiveSocket() {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 500;
    let stopped = false;

    const connect = () => {
      socket = new WebSocket(`ws://${location.host}/api/ws?k=${pageKey}`);
      socket.onopen = () => {
        delay = 500;
        setConnected(true);
        void queryClient.invalidateQueries();
      };
      socket.onmessage = event => {
        const push = JSON.parse(String(event.data)) as Push;
        if (push.type === "github") {
          void queryClient.invalidateQueries({ queryKey: ["github", push.layer ?? "notify"] });
          return;
        }
        for (const key of KEYS[push.type] ?? []) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!stopped) {
          timer = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 8000);
        }
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [queryClient]);

  return connected;
}
