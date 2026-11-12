import { create } from "zustand";

// A key press for the unchanged lines of one card: a step above (up) or below (down) a hunk, or all of them.
export type GapCommand = { card: string; act: "up" | "down" | "open" | "close"; hunk?: string; seq: number };

type GapState = {
  command: GapCommand | null;
  send: (command: Omit<GapCommand, "seq">) => void;
};

export const useGapStore = create<GapState>(set => ({
  command: null,
  send: command => set(state => ({ command: { ...command, seq: (state.command?.seq ?? 0) + 1 } })),
}));
