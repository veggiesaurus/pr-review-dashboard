import {
  CircleCheck,
  CircleDot,
  CircleSlash,
  CircleX,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { CheckCounts, GithubPerson, GithubRefInfo } from "shared/live";
import { type Ref, shortRef } from "shared/refs";

import { Avatar, AvatarFallback, AvatarImage } from "src/components/ui/avatar";
import { Badge } from "src/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "src/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "src/components/ui/tooltip";
import { useAllowed, useGithubRef } from "src/queries/live.query";
import { cn } from "src/utils/cn";
import { ago, fullDate } from "src/utils/dates";
import { tint } from "src/utils/tint";

export type GithubishRef = Exclude<Ref, { kind: "linear" }>;

export const REF_CLASS =
  "underline decoration-dotted decoration-foreground/40 underline-offset-[0.2em] hover:text-primary hover:decoration-primary";

const STATES: Record<string, { icon: LucideIcon; tone: string; label: string }> = {
  "pr:open": { icon: GitPullRequest, tone: "text-success", label: "Open" },
  "pr:draft": { icon: GitPullRequestDraft, tone: "text-muted-foreground", label: "Draft" },
  "pr:merged": { icon: GitMerge, tone: "text-primary", label: "Merged" },
  "pr:closed": { icon: GitPullRequestClosed, tone: "text-danger", label: "Closed" },
  "issue:open": { icon: CircleDot, tone: "text-success", label: "Open" },
  "issue:completed": { icon: CircleCheck, tone: "text-primary", label: "Closed as done" },
  "issue:not-planned": { icon: CircleSlash, tone: "text-muted-foreground", label: "Closed as not planned" },
  "issue:closed": { icon: CircleCheck, tone: "text-primary", label: "Closed" },
};

export function GithubAvatar({ person, size = "xs" }: { person: GithubPerson; size?: "xs" | "sm" }) {
  return (
    <Avatar size={size}>
      {person.avatar && <AvatarImage src={`/api/github/avatar/${person.login}`} alt="" />}
      <AvatarFallback>{person.login.slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

export function ChecksLine({ checks }: { checks: CheckCounts }) {
  const parts = [
    checks.fail && `${checks.fail} failing`,
    checks.pending && `${checks.pending} running`,
    checks.pass && `${checks.pass} passing`,
  ].filter(Boolean);
  const other = checks.total - checks.fail - checks.pending - checks.pass;
  if (other > 0) {
    parts.push(`${other} skipped or cancelled`);
  }
  const [Icon, tone] = checks.fail
    ? [CircleX, "text-danger"]
    : checks.pending
      ? [LoaderCircle, "text-warning"]
      : [CircleCheck, "text-success"];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className={cn("size-3.5 shrink-0", tone)} />
      {parts.join(", ")}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="whitespace-nowrap text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">{children}</dd>
    </>
  );
}

function Size({ additions, deletions, files }: { additions: number; deletions: number; files: number | null }) {
  return (
    <span className="font-mono text-xs">
      <span className="text-success">+{additions}</span> <span className="text-danger">−{deletions}</span>
      {files !== null && (
        <span className="font-sans text-[13px] text-muted-foreground"> in {files === 1 ? "1 file" : `${files} files`}</span>
      )}
    </span>
  );
}

export function GithubSummary({ info, repo }: { info: GithubRefInfo; repo: string | null }) {
  const state = info.kind === "commit" ? null : STATES[`${info.kind}:${info.state}`];
  const Icon = state?.icon ?? GitCommitHorizontal;
  const kind = info.kind === "pr" ? "Pull request" : info.kind === "issue" ? "Issue" : "Commit";
  const name =
    info.kind === "commit"
      ? shortRef({ kind: "commit", repo: info.repo, sha: info.sha }, repo)
      : shortRef({ kind: "github", repo: info.repo, number: info.number }, repo);

  return (
    <div className="grid gap-2 text-left">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Icon className={cn("size-3.5 shrink-0", state?.tone ?? "text-muted-foreground")} />
        <a href={info.url} target="_blank" rel="noreferrer" className="font-mono text-[13px] text-primary hover:underline">
          {name}
        </a>
        <span className="font-medium">{kind}</span>
        {state && <span className={cn("font-medium", state.tone)}>{state.label}</span>}
        {info.updatedAt && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-auto whitespace-nowrap text-muted-foreground">
                {info.kind === "commit" ? "committed" : "updated"} {ago(info.updatedAt)}
              </span>
            </TooltipTrigger>
            <TooltipContent>{fullDate(info.updatedAt)}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <p className="font-medium text-sm leading-snug [overflow-wrap:anywhere]">{info.title}</p>

      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 border-t pt-3 text-[13px]">
        <Row label="Author">
          {info.author ? (
            <>
              <GithubAvatar person={info.author} />
              {info.author.login}
            </>
          ) : (
            <span className="text-muted-foreground">{(info.kind === "commit" && info.authorName) || "Unknown"}</span>
          )}
        </Row>
        {info.kind === "pr" && (
          <Row label="Branches">
            <span className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">
              {info.base} ← {info.head}
            </span>
          </Row>
        )}
        {info.kind !== "issue" && (
          <Row label="Size">
            <Size additions={info.additions} deletions={info.deletions} files={info.files} />
          </Row>
        )}
        {info.kind !== "issue" && info.checks && (
          <Row label="Checks">
            <ChecksLine checks={info.checks} />
          </Row>
        )}
        {info.kind === "issue" && info.comments > 0 && <Row label="Comments">{info.comments}</Row>}
        {info.kind !== "commit" && info.labels.length > 0 && (
          <Row label="Labels">
            {info.labels.map(label => (
              <Badge key={label.name} tone="outline" className="gap-1.5 font-normal">
                <span
                  className={cn("size-2 shrink-0 rounded-full bg-muted-foreground", label.color && "tint-bg")}
                  style={tint(label.color)}
                />
                {label.name}
              </Badge>
            ))}
          </Row>
        )}
      </dl>
    </div>
  );
}

// A pull request, issue or commit the review mentions: a link with a preview on hover or keyboard focus once the server
// has found it, and as written when it can't (a #12 that names nothing stays text; a URL stays a plain link).
export function GithubRef({
  reference,
  text,
  href,
  repo,
  className,
}: {
  reference: GithubishRef;
  text: ReactNode;
  href: string | null;
  repo: string | null;
  className?: string;
}) {
  const allowed = useAllowed(reference);
  const info = useGithubRef(reference, allowed).data?.ref;
  if (!info) {
    return href ? (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {text}
      </a>
    ) : (
      text
    );
  }
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <a href={href ?? info.url} target="_blank" rel="noreferrer" className={className ?? REF_CLASS} data-ref-kind={info.kind}>
          {text}
        </a>
      </HoverCardTrigger>
      <HoverCardContent>
        <GithubSummary info={info} repo={repo} />
      </HoverCardContent>
    </HoverCard>
  );
}
