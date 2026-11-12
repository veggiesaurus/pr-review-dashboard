import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  type LucideIcon,
  Minus,
  SignalHigh,
  SignalLow,
  SignalMedium,
} from "lucide-react";
import type { ReactNode } from "react";
import type { LinearIssue, LinearPerson } from "shared/live";
import { REF_CLASS } from "src/components/links/Github";
import { Avatar, AvatarFallback, AvatarImage } from "src/components/ui/avatar";
import { Badge } from "src/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "src/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "src/components/ui/tooltip";
import { useAllowed, useLinearIssue } from "src/queries/live.query";
import { useReview } from "src/queries/review.query";
import { cn } from "src/utils/cn";
import { ago, fullDate, isNow, isPast, shortDay } from "src/utils/dates";
import { tint } from "src/utils/tint";

const STATE_ICONS: Record<string, LucideIcon> = {
  backlog: CircleDashed,
  unstarted: Circle,
  started: CircleDot,
  completed: CircleCheck,
  canceled: CircleX,
};
// Linear's priority numbers: 0 none, 1 urgent, then high, medium and low.
const PRIORITY_ICONS: LucideIcon[] = [Minus, CircleAlert, SignalHigh, SignalMedium, SignalLow];
const CLOSED = ["completed", "canceled"];

function StateIcon({ issue, className }: { issue: LinearIssue; className?: string }) {
  const Icon = STATE_ICONS[issue.stateType ?? ""] ?? Circle;
  return (
    <Icon className={cn("size-3.5 shrink-0 text-muted-foreground", issue.stateColor && "tint", className)} style={tint(issue.stateColor)} />
  );
}

function Dot({ color }: { color: string | null }) {
  return <span className={cn("size-2 shrink-0 rounded-full bg-muted-foreground", color && "tint-bg")} style={tint(color)} />;
}

export function PersonAvatar({
  issueKey,
  who,
  person,
  size = "sm",
}: {
  issueKey: string;
  who: "assignee" | "creator";
  person: LinearPerson;
  size?: "xs" | "sm";
}) {
  return (
    <Avatar size={size}>
      {person.avatar && <AvatarImage src={`/api/linear/${issueKey}/avatar/${who}`} alt="" />}
      <AvatarFallback className={cn(person.color && "text-white")} style={{ backgroundColor: person.color ?? undefined }}>
        {person.initials}
      </AvatarFallback>
    </Avatar>
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

export function IssueSummary({ issue }: { issue: LinearIssue }) {
  const { assignee, creator, project, cycle, parent, subIssues } = issue;
  const overdue = issue.dueDate && isPast(issue.dueDate) && !CLOSED.includes(issue.stateType ?? "");
  const PriorityIcon = PRIORITY_ICONS[issue.priorityLevel ?? 0] ?? Minus;
  const link = "hover:text-primary hover:underline";

  return (
    <div className="grid gap-2 text-left">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <StateIcon issue={issue} />
        <a href={issue.url} target="_blank" rel="noreferrer" className="font-mono text-[13px] text-primary hover:underline">
          {issue.identifier}
        </a>
        {issue.state && <span className="font-medium">{issue.state}</span>}
        {issue.team && <span className="text-muted-foreground">{issue.team}</span>}
        {issue.priority && Boolean(issue.priorityLevel) && (
          <span className="ml-auto inline-flex items-center gap-1 whitespace-nowrap text-foreground/75">
            <PriorityIcon className={cn("size-3.5", issue.priorityLevel === 1 && "text-danger")} />
            {issue.priority}
          </span>
        )}
      </div>
      <p className="font-medium text-sm leading-snug">{issue.title}</p>
      {issue.description && (
        <p className="line-clamp-3 text-[13px] text-foreground/70 leading-normal [overflow-wrap:anywhere]">{issue.description}</p>
      )}

      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 border-t pt-3 text-[13px]">
        <Row label="Assignee">
          {assignee ? (
            <>
              <PersonAvatar issueKey={issue.identifier} who="assignee" person={assignee} size="xs" />
              {assignee.name}
            </>
          ) : (
            <span className="text-muted-foreground">Nobody yet</span>
          )}
        </Row>
        {issue.estimate !== null && (
          <Row label="Estimate">
            <span className="font-mono">{issue.estimate}</span>
          </Row>
        )}
        {project && (
          <Row label="Project">
            <Dot color={project.color} />
            {project.url ? (
              <a href={project.url} target="_blank" rel="noreferrer" className={link}>
                {project.name}
              </a>
            ) : (
              project.name
            )}
            {issue.milestone && <span className="text-muted-foreground">{issue.milestone}</span>}
          </Row>
        )}
        {cycle && (
          <Row label="Cycle">
            {cycle.name}
            {cycle.startsAt && cycle.endsAt && (
              <span className="text-muted-foreground">
                {shortDay(cycle.startsAt)} to {shortDay(cycle.endsAt)}
                {isNow(cycle.startsAt, cycle.endsAt) && ", current"}
              </span>
            )}
          </Row>
        )}
        {issue.dueDate && (
          <Row label="Due">
            <span className={cn(overdue && "font-medium text-danger")}>
              {shortDay(issue.dueDate)}
              {overdue && ", overdue"}
            </span>
          </Row>
        )}
        {issue.labels.length > 0 && (
          <Row label="Labels">
            {issue.labels.map(label => (
              <Badge key={label.name} tone="outline" className="gap-1.5 font-normal">
                <Dot color={label.color} />
                {label.name}
              </Badge>
            ))}
          </Row>
        )}
        {parent && (
          <Row label="Parent">
            <span className="flex w-full min-w-0 items-baseline gap-1.5">
              <span className="shrink-0 whitespace-nowrap font-mono text-muted-foreground text-xs">{parent.identifier}</span>
              {parent.url ? (
                <a href={parent.url} target="_blank" rel="noreferrer" className={cn("min-w-0 truncate", link)}>
                  {parent.title}
                </a>
              ) : (
                <span className="min-w-0 truncate">{parent.title}</span>
              )}
            </span>
          </Row>
        )}
        {subIssues.total > 0 && (
          <Row label="Sub-issues">
            {subIssues.done} of {subIssues.total} done
          </Row>
        )}
        {issue.updatedAt && (
          <Row label="Updated">
            <Tooltip>
              <TooltipTrigger asChild>
                <span>{ago(issue.updatedAt)}</span>
              </TooltipTrigger>
              <TooltipContent>{fullDate(issue.updatedAt)}</TooltipContent>
            </Tooltip>
            {creator && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                opened by
                <PersonAvatar issueKey={issue.identifier} who="creator" person={creator} size="xs" />
                {creator.name}
              </span>
            )}
          </Row>
        )}
      </dl>
    </div>
  );
}

const CHIP =
  "inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 font-mono text-xs whitespace-nowrap hover:border-primary/50";

// An issue the review names, as a link that opens the issue's details on hover or keyboard focus. label and href are
// for a link written in the text; without an answer from Linear it shows as written.
export function IssueRef({
  issueKey,
  chip = false,
  label,
  href,
  className,
}: {
  issueKey: string;
  chip?: boolean;
  label?: ReactNode;
  href?: string | null;
  className?: string;
}) {
  const linear = useReview().data?.linear ?? false;
  // The header's chips are keys the PR names, which the server always answers for.
  const allowed = useAllowed({ kind: "linear", key: issueKey });
  const issue = useLinearIssue(issueKey, linear && (chip || allowed)).data?.issue;
  if (!issue) {
    if (chip) {
      return (
        <Badge tone="outline" className="font-mono">
          {issueKey}
        </Badge>
      );
    }
    return href ? (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {label ?? issueKey}
      </a>
    ) : (
      (label ?? issueKey)
    );
  }
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <a
          href={href ?? issue.url}
          target="_blank"
          rel="noreferrer"
          className={chip ? CHIP : (className ?? REF_CLASS)}
          data-ref-kind="linear"
        >
          {chip && <StateIcon issue={issue} />}
          {chip ? issueKey : (label ?? issueKey)}
          {chip && issue.assignee && (
            <span className="-mr-1 flex">
              <PersonAvatar issueKey={issueKey} who="assignee" person={issue.assignee} size="xs" />
            </span>
          )}
        </a>
      </HoverCardTrigger>
      <HoverCardContent>
        <IssueSummary issue={issue} />
      </HoverCardContent>
    </HoverCard>
  );
}
