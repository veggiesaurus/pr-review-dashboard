import type { FormEvent } from "react";
import type { Message, ThreadEvent } from "shared/messages";

import { Marker, MarkerContent } from "src/components/ui/marker";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "src/components/ui/questionnaire";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceLine,
  TraceTitle,
} from "src/components/ui/trace";
import { ago, fullDate } from "src/utils/dates";

export type Entry = { message: Message } | { steps: ThreadEvent[] } | { note: ThreadEvent };

// A thread in the order things happened: its messages, with the steps Claude took and the notes on it between them.
// Steps that follow one another are one entry, so they fold into a line.
export function timeline(root: Message, replies: Message[]): Entry[] {
  const items = [
    ...[root, ...replies].map(message => ({ at: message.at, message, event: undefined })),
    ...(root.events ?? []).map(event => ({ at: event.at, message: undefined, event })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : Number(Boolean(a.event)) - Number(Boolean(b.event))));
  const entries: Entry[] = [];
  for (const { message, event } of items) {
    const last = entries.at(-1);
    if (message) {
      entries.push({ message });
    } else if (event?.kind === "note") {
      entries.push({ note: event });
    } else if (event && last && "steps" in last) {
      last.steps.push(event);
    } else if (event) {
      entries.push({ steps: [event] });
    }
  }
  return entries;
}

function took(steps: ThreadEvent[]) {
  const seconds = Math.round((Date.parse(steps.at(-1)?.at ?? "") - Date.parse(steps[0]?.at ?? "")) / 1000);
  return seconds < 1 ? "" : seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

// What Claude did between two messages. While it is still at it the line is the step in hand and the list is open;
// afterwards it folds to a count.
export function Steps({ steps, running }: { steps: ThreadEvent[]; running: boolean }) {
  const count = `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
  return (
    <Trace className="text-xs">
      <TraceCollapsible key={String(running)} defaultOpen={running}>
        <TraceCollapsibleTrigger aria-label={running ? `Working: ${count} so far` : `${count} Claude took`}>
          <TraceLine status={running ? "running" : undefined} className="text-xs">
            <TraceTitle>{running ? steps.at(-1)?.text : count}</TraceTitle>
            {!running && <TraceDescription>{took(steps)}</TraceDescription>}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="grid gap-1 text-xs">
          {steps.map(step => (
            <TraceLine key={step.at} className="text-xs">
              <TraceTitle className="whitespace-normal">{step.text}</TraceTitle>
              <TraceDescription title={fullDate(step.at)}>{ago(step.at)}</TraceDescription>
            </TraceLine>
          ))}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

// Something that became of the thread, such as being marked done or sent back after a rebuild.
export function Note({ note }: { note: ThreadEvent }) {
  return (
    <Marker variant="separator" className="text-xs">
      <MarkerContent>
        {note.text},{" "}
        <time dateTime={note.at} title={fullDate(note.at)}>
          {ago(note.at)}
        </time>
      </MarkerContent>
    </Marker>
  );
}

// Claude's questions, each with its choices and room for another answer. What is picked goes back as a follow-up.
export function Ask({ message, pending, onAnswer }: { message: Message; pending: boolean; onAnswer: (text: string) => void }) {
  const questions = message.ask ?? [];
  const name = (index: number) => `q${index}`;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const answers = questions.map((_, index) =>
      form
        .getAll(name(index))
        .map(value => String(value).trim())
        .filter(Boolean)
        .join("; "),
    );
    const text = questions.length === 1 ? answers[0] : questions.map((q, index) => `${q.question} ${answers[index]}`).join("\n");
    if (text?.trim()) {
      onAnswer(text);
    }
  };
  return (
    <Questionnaire
      items={questions.map((q, index) => ({ name: name(index), required: true, choices: q.options.map(value => ({ value })) }))}
      onSubmit={submit}
      className="rounded-md border bg-background p-3"
    >
      {questions.length > 1 && <QuestionnaireProgress />}
      {questions.map((q, index) => (
        <QuestionnaireItem key={q.question} name={name(index)} multiple={q.multiple} required>
          <QuestionnaireTitle className="text-sm">{q.question}</QuestionnaireTitle>
          <QuestionnaireChoices>
            {q.options.map(option => (
              <QuestionnaireChoice key={option} value={option} className="text-sm">
                {option}
              </QuestionnaireChoice>
            ))}
          </QuestionnaireChoices>
          <QuestionnaireInput placeholder="Another answer" aria-label="Another answer" className="text-sm" />
          <QuestionnaireError />
        </QuestionnaireItem>
      ))}
      <QuestionnaireActions>
        <QuestionnairePrevious size="sm" />
        <QuestionnaireNext size="sm" />
        <QuestionnaireSubmit size="sm" disabled={pending}>
          Send answer
        </QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  );
}
