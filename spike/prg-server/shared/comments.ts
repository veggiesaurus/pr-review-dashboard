import { z } from "zod";

// GitHub's review threads on a layer's pull request, read through gh, and notes posted there as a review.

export type GithubComment = {
  id: string;
  author: string | null;
  // Whether the server has a picture for the author: GET /api/layers/:layer/comments/avatar/:login.
  avatar: boolean;
  body: string;
  at: string;
  url: string | null;
  // In a review the viewer hasn't submitted yet, so only they can see it.
  pending: boolean;
};

// Where the page shows a thread: a line of the layer's diff, as a line anchor would name it.
export type ThreadPlace = { file: string; hunk: string; side: "L" | "R"; line: number; endLine?: number };

export type GithubThread = {
  id: string;
  path: string;
  line: number | null;
  startLine: number | null;
  side: "LEFT" | "RIGHT";
  resolved: boolean;
  outdated: boolean;
  // A comment on the whole file rather than a line.
  onFile: boolean;
  comments: GithubComment[];
  // Null when it isn't on a line of this diff: outdated, on the file, or on a line the diff doesn't show.
  place: ThreadPlace | null;
};

export type CommentsResponse = {
  threads: GithubThread[];
  // More threads than one read takes.
  more: boolean;
  // GitHub's head isn't the commit the guide was built from, so line numbers may be off.
  headMoved: boolean;
  // Whether the server was started with --github-comments, so notes can be posted.
  canPost: boolean;
  error: string | null;
  at: string;
};

export const postModeSchema = z.enum(["pending", "now"]);
export type PostMode = z.infer<typeof postModeSchema>;

export const previewSchema = z.object({
  ids: z
    .array(z.string().regex(/^m\d{1,9}$/))
    .min(1)
    .max(50),
  mode: postModeSchema,
  summary: z.string().trim().max(4000).default(""),
});

export const postSchema = previewSchema.extend({
  // From the preview: the post goes only if it is still exactly what was shown.
  confirm: z.string().regex(/^[0-9a-f]{64}$/),
  // Keep the posted drafts as notes for Claude as well.
  keep: z.boolean().default(false),
});

export type PreviewRequest = z.input<typeof previewSchema>;
export type PostRequest = z.input<typeof postSchema>;

export type ReviewComment = {
  id: string;
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
  body: string;
};

export type PostPreview = {
  login: string;
  repo: string;
  number: number;
  commit: string;
  mode: PostMode;
  summary: string;
  comments: ReviewComment[];
  // Notes that can't go, with why.
  refused: { id: string; reason: string }[];
  // GitHub allows one pending review per person on a pull request.
  pendingExists: boolean;
  confirm: string;
};

export type PostResult = { posted: number; url: string | null; pending: boolean };
