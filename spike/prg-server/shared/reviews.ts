import type { Message } from "./messages";

// The code-review skill's effort levels the page offers; its costliest, max, is left to the terminal.
export const REVIEW_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export type ReviewEffort = (typeof REVIEW_EFFORTS)[number];

// How bad a finding is. The skill ranks its findings; the session puts each in one of these.
export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

// Where a finding stands, in the order a review lists them. One whose code left the diff is outdated unless it was
// settled first.
export const STANDINGS = ["open", "fixed", "dismissed", "outdated"] as const;
export type Standing = (typeof STANDINGS)[number];
export const standing = (finding: Pick<Message, "state" | "anchor" | "review">): Standing =>
  finding.review?.dismissed ? "dismissed" : finding.state === "done" ? "fixed" : finding.anchor.outdated ? "outdated" : "open";

// Why the user put a finding away. The first two are told to later reviews of the same repo, so they don't come back.
export const DISMISS_REASONS = ["false-positive", "intentional", "later"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];
export const DISMISS_TEXT: Record<DismissReason, string> = {
  "false-positive": "False positive",
  intentional: "Intentional",
  later: "Fix later",
};
