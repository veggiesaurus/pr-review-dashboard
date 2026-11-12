// The code-review skill's effort levels the page offers; its costliest, max, is left to the terminal.
export const REVIEW_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export type ReviewEffort = (typeof REVIEW_EFFORTS)[number];

// How bad a finding is. The skill ranks its findings; the session puts each in one of these.
export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];
