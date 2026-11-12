import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TICK_PREFIX } from "shared/ticks";
import { api } from "src/queries/api";
import { create } from "zustand";

const KEY = ["ticks"];
const NONE = new Set<string>();
const save = (keys: string[], done: boolean) => api.post("ticks", { json: { keys, done } }).json<string[]>();

// Ticks this browser kept before the server did. They go up once and are then removed here.
async function moveLocalTicks() {
  try {
    const local = Object.keys(localStorage).filter(key => key.startsWith(TICK_PREFIX) && localStorage.getItem(key) === "1");
    for (let at = 0; at < local.length; at += 500) {
      const part = local.slice(at, at + 500);
      await save(part, true);
      for (const key of part) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage can be blocked, and a failed upload is tried again on the next load.
  }
}

async function fetchTicks() {
  await moveLocalTicks();
  return api.get("ticks").json<string[]>();
}

// Ticks made here that the server hasn't answered for yet, so a box changes in the click itself and not a moment after.
const usePending = create<Record<string, boolean>>(() => ({}));

// Whether a key is ticked. The server keeps the ticks, so they follow the review to another browser or device.
export function useTicks() {
  const saved = useQuery({ queryKey: KEY, queryFn: fetchTicks, select: (keys: string[]) => new Set(keys) }).data ?? NONE;
  const pending = usePending();
  return (key: string) => pending[key] ?? saved.has(key);
}

export function useSetTicks() {
  const queryClient = useQueryClient();
  const { mutate } = useMutation({
    mutationKey: KEY,
    mutationFn: ({ keys, done }: { keys: string[]; done: boolean }) => save(keys, done),
    // The last of several in flight refetches, then lets the server's list stand, so an older answer can't undo a newer tick.
    onSettled: async () => {
      const last = () => queryClient.isMutating({ mutationKey: KEY }) === 1;
      if (last()) {
        await queryClient.invalidateQueries({ queryKey: KEY });
        if (last()) {
          usePending.setState({}, true);
        }
      }
    },
  });
  return (keys: string[], done: boolean) => {
    usePending.setState(Object.fromEntries(keys.map(key => [key, done])));
    mutate({ keys, done });
  };
}
