import { useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleSlash,
  CircleX,
  ExternalLink,
  GitBranch,
  LoaderCircle,
  type LucideIcon,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Check, CheckBucket, GithubLive, LivePr, Reviewer } from "shared/live";
import { AskClaude } from "src/components/chat/AskClaude";
import { GithubAvatar } from "src/components/links/Github";
import { IssueSummary } from "src/components/links/Issue";
import { Badge, type Tone } from "src/components/ui/badge";
import { Button } from "src/components/ui/button";
import { Switch } from "src/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "src/components/ui/tooltip";
import { fetchGithub, useCiNotify, useGithub, useLinearIssue, useSetCiNotify } from "src/queries/live.query";
import { useLayer, useReview } from "src/queries/review.query";
import { cn } from "src/utils/cn";
import { ago, fullDate } from "src/utils/dates";

const GROUPS: { bucket: CheckBucket; label: string; icon: LucideIcon; tone: string }[] = [
  { bucket: "fail", label: "Failed", icon: CircleX, tone: "text-danger" },
  { bucket: "expected", label: "Required, not reported", icon: CircleDashed, tone: "text-warning" },
  { bucket: "pending", label: "Running", icon: LoaderCircle, tone: "text-warning" },
  { bucket: "cancel", label: "Cancelled", icon: CircleSlash, tone: "text-muted-foreground" },
  { bucket: "pass", label: "Passed", icon: CircleCheck, tone: "text-success" },
  { bucket: "skipping", label: "Skipped", icon: CircleMinus, tone: "text-muted-foreground" },
];
const STATE_TONES: Record<string, Tone> = { OPEN: "success", MERGED: "primary", CLOSED: "danger" };
const DECISIONS: Record<string, { label: string; tone: Tone }> = {
  APPROVED: { label: "Approved", tone: "success" },
  CHANGES_REQUESTED: { label: "Changes requested", tone: "danger" },
  REVIEW_REQUIRED: { label: "Review required", tone: "warning" },
};
const REVIEW_WORDS: Record<Reviewer["state"], string> = {
  approved: "approved",
  changes: "asked for changes",
  commented: "commented",
  dismissed: "review dismissed",
  requested: "asked to review",
};

function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Re-renders every few seconds while something is running, so its time keeps counting.
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function took(check: Check, now: number) {
  if (!check.startedAt) {
    return null;
  }
  const start = Date.parse(check.startedAt);
  if (check.completedAt) {
    return duration(Date.parse(check.completedAt) - start);
  }
  return check.bucket === "pending" ? `${duration(now - start)} so far` : null;
}

function CheckRow({ check, layer, now }: { check: Check; layer: number; now: number }) {
  const time = took(check, now);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-1" data-check={check.bucket}>
      <span className="min-w-0">
        {check.link ? (
          <a href={check.link} target="_blank" rel="noreferrer" className="font-medium hover:text-primary hover:underline">
            {check.name}
          </a>
        ) : (
          <span className="font-medium">{check.name}</span>
        )}
        {check.workflow && <span className="ml-2 text-muted-foreground text-xs">{check.workflow}</span>}
      </span>
      <span className="flex items-center gap-2 whitespace-nowrap">
        {time && <span className="font-mono text-muted-foreground text-xs">{time}</span>}
        {check.bucket === "fail" && <AskClaude anchor={{ kind: "check", layer, name: check.name }} label="Ask" />}
      </span>
    </li>
  );
}

function Checks({ live, layer }: { live: GithubLive; layer: number }) {
  const running = live.checks.some(check => check.bucket === "pending");
  const now = useNow(running);
  if (live.checks.length === 0) {
    return <p className="text-muted-foreground text-sm">No checks on this pull request.</p>;
  }
  return (
    <div className="grid gap-2">
      {GROUPS.map(group => {
        const checks = live.checks.filter(check => check.bucket === group.bucket).sort((a, b) => a.name.localeCompare(b.name));
        if (checks.length === 0) {
          return null;
        }
        const Icon = group.icon;
        const quiet = (group.bucket === "pass" || group.bucket === "skipping") && checks.length > 8;
        return (
          <details key={group.bucket} open={!quiet} className="group/checks motion-expand" data-group={group.bucket}>
            <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-sm [&::-webkit-details-marker]:hidden">
              <Icon className={cn("size-4 shrink-0", group.tone, group.bucket === "pending" && "motion-safe:animate-spin")} />
              {group.label}
              <span className="font-mono text-muted-foreground text-xs">{checks.length}</span>
            </summary>
            <ul className="mt-0.5 border-l pl-3 ml-[7px] text-sm">
              {checks.map(check => (
                <CheckRow key={`${check.workflow}/${check.name}`} check={check} layer={layer} now={now} />
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

function mergeText(pr: LivePr): { text: string; tone: string } | null {
  if (pr.state !== "OPEN") {
    return null;
  }
  if (pr.mergeable === "CONFLICTING" || pr.mergeState === "DIRTY") {
    return { text: `Conflicts with ${pr.base}`, tone: "text-danger" };
  }
  switch (pr.mergeState) {
    case "BEHIND":
      return { text: `No conflicts, but behind ${pr.base}`, tone: "text-warning" };
    case "BLOCKED":
      return { text: "No conflicts; blocked until the required reviews or checks pass", tone: "text-warning" };
    case "UNSTABLE":
      return { text: "No conflicts; some checks aren't passing", tone: "text-warning" };
    case "CLEAN":
    case "HAS_HOOKS":
      return { text: `No conflicts with ${pr.base}`, tone: "text-success" };
    case "DRAFT":
      return { text: pr.mergeable === "MERGEABLE" ? `No conflicts with ${pr.base}` : "A draft", tone: "text-muted-foreground" };
    default:
      return { text: "GitHub is still working out whether it merges cleanly", tone: "text-muted-foreground" };
  }
}

function Reviewers({ pr }: { pr: LivePr }) {
  const decision = pr.reviewDecision ? DECISIONS[pr.reviewDecision] : undefined;
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Reviews</span>
        {decision ? (
          <Badge tone={decision.tone}>{decision.label}</Badge>
        ) : (
          pr.reviewers.length === 0 && <span className="text-muted-foreground">None yet</span>
        )}
      </div>
      {pr.reviewers.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {pr.reviewers.map(reviewer => (
            <li key={`${reviewer.team}/${reviewer.login}`} className="flex items-center gap-2">
              {reviewer.team ? (
                <span className="flex size-4.5 items-center justify-center rounded-full bg-muted text-[0.5625rem]">T</span>
              ) : (
                <GithubAvatar person={reviewer} />
              )}
              <span className="font-medium">{reviewer.login}</span>
              <span
                className={cn(
                  "text-muted-foreground",
                  reviewer.state === "approved" && "text-success",
                  reviewer.state === "changes" && "text-danger",
                )}
              >
                {REVIEW_WORDS[reviewer.state]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The PR's head moved past the commit the guide was built from: the diff here is behind.
export function MovedNotice({ pr, layer }: { pr: LivePr; layer: number }) {
  if (!pr.moved) {
    return null;
  }
  return (
    <div className="flex items-start gap-2 rounded-md bg-warning/14 p-2.5 text-sm" role="status">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="grid gap-1.5">
        <p>
          The branch has moved on. GitHub has <code className="font-mono text-[0.875em]">{pr.headSha.slice(0, 7)}</code>, and this guide was
          built from <code className="font-mono text-[0.875em]">{pr.builtSha?.slice(0, 7)}</code>, so the diff and the guide here are
          behind. Ask Claude to rebuild the guide.
        </p>
        <AskClaude anchor={{ kind: "general", layer }} label="Ask Claude to rebuild" className="w-fit" />
      </div>
    </div>
  );
}

function LinearCard({ issueKey, enabled }: { issueKey: string; enabled: boolean }) {
  const { data, isPending } = useLinearIssue(issueKey, enabled);
  if (!enabled) {
    return (
      <p className="text-muted-foreground text-sm">
        Set <code className="font-mono">LINEAR_API_KEY</code> to see {issueKey}.
      </p>
    );
  }
  if (isPending) {
    return (
      <div className="grid gap-2 rounded-md border bg-background p-3" aria-hidden>
        <div className="motion-skeleton h-4 w-2/3" />
        <div className="motion-skeleton h-3 w-full" />
        <div className="motion-skeleton h-3 w-5/6" />
      </div>
    );
  }
  if (data?.reason === "not-found") {
    return null;
  }
  if (!data?.issue) {
    return <p className="text-muted-foreground text-sm">Linear didn't answer for {issueKey}.</p>;
  }
  return (
    <div className="rounded-md border bg-background p-3">
      <IssueSummary issue={data.issue} />
    </div>
  );
}

function NotifySwitch() {
  const { data } = useCiNotify();
  const set = useSetCiNotify();
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Switch
        id="ci-notify"
        checked={data?.on ?? false}
        onCheckedChange={on => set.mutate(on)}
        disabled={set.isPending}
        className="mt-0.5"
      />
      <label htmlFor="ci-notify" className="cursor-pointer">
        Tell Claude when checks finish or one fails
        <span className="block text-muted-foreground text-xs">Each change wakes the Claude session with one message naming the check.</span>
      </label>
    </div>
  );
}

export function LivePanel({ layer }: { layer: number }) {
  const queryClient = useQueryClient();
  const linear = useReview().data?.linear ?? false;
  const shown = useLayer(layer);
  const github = shown?.capabilities.github ?? false;
  const issueKeys = shown?.issueKeys ?? [];
  const { data: live, isPending } = useGithub(layer, github);
  const [refreshing, setRefreshing] = useState(false);
  const pr = live?.pr;
  const merge = pr ? mergeText(pr) : null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      queryClient.setQueryData(["github", layer], await fetchGithub(layer, true));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="grid gap-4 rounded-lg border bg-card p-4 shadow-xs" aria-label="Live from GitHub and Linear">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-serif text-lg">Live from GitHub{issueKeys.length > 0 ? " and Linear" : ""}</h2>
        {pr?.previews.map((preview, i) => (
          <a
            key={preview.url}
            href={preview.url}
            target="_blank"
            rel="noreferrer"
            title={preview.url}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 font-medium text-[13px] hover:bg-accent",
              i > 0 && "font-normal text-muted-foreground",
            )}
          >
            <ExternalLink className="size-3.5" />
            {i === 0 ? "Preview" : preview.label}
          </a>
        ))}
        {github && (
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Ask GitHub again"
            title="Ask GitHub again"
          >
            <RefreshCw className={cn(refreshing && "motion-safe:animate-spin")} />
          </Button>
        )}
      </div>

      {!github && <p className="text-muted-foreground text-sm">This review has no pull request behind it.</p>}
      {github && isPending && <p className="motion-loading text-muted-foreground text-sm">Asking GitHub…</p>}
      {live?.error && <p className="text-danger text-sm">{live.error}</p>}

      {pr && (
        <>
          <MovedNotice pr={pr} layer={layer} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <Badge tone={pr.isDraft ? "neutral" : (STATE_TONES[pr.state] ?? "neutral")}>
              {pr.isDraft ? "Draft" : pr.state.toLowerCase()}
            </Badge>
            <span className="inline-flex min-w-0 items-center gap-1 font-mono text-muted-foreground text-xs [overflow-wrap:anywhere]">
              <GitBranch className="size-3.5 shrink-0" />
              {pr.base} ← {pr.head}
            </span>
            {merge && <span className={cn("font-medium", merge.tone)}>{merge.text}</span>}
          </div>
          <Checks live={live} layer={layer} />
          <Reviewers pr={pr} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <NotifySwitch />
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground text-xs">Checked {ago(live.at)}</span>
              </TooltipTrigger>
              <TooltipContent>
                {fullDate(live.at)}. The server asks again every 20 seconds while checks run and every few minutes once they settle, only
                while this page is open.
              </TooltipContent>
            </Tooltip>
          </div>
        </>
      )}

      {issueKeys.length > 0 && (
        <div className="grid gap-2">
          {issueKeys.map(key => (
            <LinearCard key={key} issueKey={key} enabled={linear} />
          ))}
        </div>
      )}
    </section>
  );
}
