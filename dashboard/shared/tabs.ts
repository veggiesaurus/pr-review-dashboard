export const TABS = ["overview", "guide", "diff", "visualize"] as const;
export type Tab = (typeof TABS)[number];
