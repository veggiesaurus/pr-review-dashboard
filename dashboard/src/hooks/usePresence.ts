import { useEffect, useRef } from "react";
import type { Where } from "shared/messages";
import type { Tab } from "shared/tabs";

import { sendLive } from "src/hooks/useLiveSocket";

const EVERY = 500;

// Tells the server where this reader is: on connecting, on a change of layer, tab or section, and when the window is
// hidden or shown, at most every half second.
export function usePresence(connected: boolean, layer: number | null, tab: Tab, section: number | null) {
  const latest = useRef<Where | null>(null);
  const sentAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flush = useRef(() => {});
  flush.current = () => {
    timer.current = undefined;
    if (latest.current) {
      sentAt.current = Date.now();
      sendLive({ ...latest.current, hidden: document.hidden });
    }
  };
  const schedule = useRef(() => {
    if (timer.current === undefined) {
      timer.current = setTimeout(() => flush.current(), Math.max(0, sentAt.current + EVERY - Date.now()));
    }
  }).current;

  useEffect(() => {
    if (connected && layer !== null) {
      latest.current = { type: "where", layer, tab, section: tab === "guide" ? section : null, hidden: document.hidden };
      schedule();
    }
  }, [connected, layer, tab, section, schedule]);

  useEffect(() => {
    document.addEventListener("visibilitychange", schedule);
    return () => {
      document.removeEventListener("visibilitychange", schedule);
      clearTimeout(timer.current);
    };
  }, [schedule]);
}
