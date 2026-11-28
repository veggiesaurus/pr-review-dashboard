// guide and diff are the Changes view by section and by file; diagrams sit in the guide.
export const TABS = ["overview", "guide", "diff"] as const;
export type Tab = (typeof TABS)[number];
