export const TABS = ["overview", "guide", "diff"] as const;
export type Tab = (typeof TABS)[number];
