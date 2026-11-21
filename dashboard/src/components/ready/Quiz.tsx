import { Check, ListChecks, X } from "lucide-react";
import { useMemo } from "react";
import type { Anchor, Message, Solver } from "shared/messages";

import { AskClaude } from "src/components/chat/AskClaude";
import { jumpTo, shortLabel } from "src/components/chat/notes";
import { handleOf } from "src/components/links/Github";
import { MessageText } from "src/components/links/Markdown";
import { Prose } from "src/components/links/Prose";
import { Button } from "src/components/ui/button";
import { BLOCK, BLOCK_LIST, BLOCK_TITLE, Summary, ToneDot } from "src/components/ui/disclosure";
import { useIsOwner } from "src/queries/me.query";
import { errorText, usePick, useRequestQuiz } from "src/queries/messages.mutation";
import { useMessages, useSession } from "src/queries/messages.query";
import { usePeople } from "src/queries/people.query";
import { useReview } from "src/queries/review.query";
import { cn } from "src/utils/cn";

const NOTE = "mt-1.5 text-[13.5px] text-muted-foreground";

// The newest quiz the owner asked for on one PR: the request, Claude's line on what it covers, and its questions.
// One whose code a rebuild changed has lapsed, and is counted but not asked.
function useQuiz(layer: number) {
  const { data: messages = [] } = useMessages();
  return useMemo(() => {
    const request = messages.findLast(
      m => m.quiz && m.from === "user" && !m.replyTo && !m.archived && "layer" in m.anchor && m.anchor.layer === layer,
    );
    const all = messages.filter(m => request && m.quiz?.options && m.quiz.n === request.quiz?.n && m.from === "claude" && !m.replyTo);
    const questions = all.filter(m => !m.anchor.outdated);
    const covers = request && messages.findLast(m => m.replyTo === request.id && m.from === "claude");
    return { request, questions, lapsed: all.length - questions.length, covers };
  }, [messages, layer]);
}

// Asks Claude to write a quiz on this PR. Writing one runs the session, so the button is the owner's.
export function QuizButton({ layer }: { layer: number }) {
  const { request, questions, lapsed } = useQuiz(layer);
  const ask = useRequestQuiz();
  const writing = Boolean(request && !request.resolved && questions.length + lapsed === 0);
  if (!useIsOwner()) {
    return null;
  }
  return (
    <>
      {ask.isError && <span className="text-danger text-sm">{errorText(ask.error, "That didn't send.")}</span>}
      <Button
        size="sm"
        variant="outline"
        disabled={writing || ask.isPending}
        title="A few questions on the riskiest parts of this change"
        onClick={() => ask.mutate(layer)}
      >
        <ListChecks />
        {writing ? "Writing the quiz…" : request ? "Quiz me again" : "Quiz me"}
      </Button>
    </>
  );
}

// What a question is about, as an anchor a new thread can take.
function about({ anchor }: Message): Anchor | null {
  if (anchor.kind === "hunk") {
    return { kind: "hunk", layer: anchor.layer, file: anchor.file, hunk: anchor.hunk };
  }
  return anchor.kind === "file" ? { kind: "file", layer: anchor.layer, file: anchor.file } : null;
}

// One question: its options until the right one is picked, then why it is right. A wrong pick is struck out and
// points back at the code, which is what the quiz is for.
function Question({ question, layer }: { question: Message; layer: number }) {
  const review = useReview().data;
  const pick = usePick();
  const { options = [], picked = [], answer, why } = question.quiz ?? {};
  const solved = answer !== undefined;
  const anchor = about(question);
  const code = anchor && (
    <>
      <button
        type="button"
        className="cursor-pointer font-mono text-xs underline decoration-dotted decoration-muted-foreground underline-offset-[3px] hover:text-primary"
        onClick={() => jumpTo(anchor, review)}
      >
        {shortLabel(question.anchor)}
      </button>
      <AskClaude anchor={anchor} className="ml-1 align-middle" />
    </>
  );
  return (
    <li data-question={solved ? "right" : picked.length ? "missed" : "open"}>
      <Prose text={question.text} layer={layer} />
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset draws its own border and legend */}
      <div role="group" aria-label="Options" className="mt-1.5 grid gap-1">
        {options.map((option, index) => {
          const right = solved && index === answer;
          const wrong = !right && picked.includes(index);
          return (
            <button
              key={option}
              type="button"
              disabled={solved || wrong || pick.isPending}
              data-option={right ? "right" : wrong ? "wrong" : undefined}
              onClick={() => pick.mutate({ id: question.id, choice: index })}
              className={cn(
                "flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-left",
                !solved && !wrong && "cursor-pointer hover:bg-muted",
                right && "border-success/50 bg-success/10",
                wrong && "text-muted-foreground line-through decoration-muted-foreground/60",
                solved && !right && !wrong && "text-muted-foreground",
              )}
            >
              {right ? (
                <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
              ) : wrong ? (
                <X aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger" />
              ) : (
                <span aria-hidden className="mt-0.5 size-3.5 shrink-0 rounded-full border" />
              )}
              <span className="min-w-0">
                {(right || wrong) && <span className="sr-only">{right ? "Right: " : "Wrong: "}</span>}
                <Prose text={option} layer={layer} />
              </span>
            </button>
          );
        })}
      </div>
      {pick.isError && <p className="mt-1 text-danger">{errorText(pick.error, "That didn't send.")}</p>}
      {solved ? (
        <p className="mt-1.5">
          <Prose text={why ?? ""} layer={layer} /> {code}
        </p>
      ) : (
        picked.length > 0 && (
          <p className="mt-1.5 text-muted-foreground">Not that one. {code ? <>Look again at {code}</> : "Look at the change again."}</p>
        )
      )}
    </li>
  );
}

// "the owner and @gus": the others who have every question right.
function useSolvers(questions: Message[]) {
  const people = usePeople();
  const all = (questions[0]?.quiz?.solvers ?? []).filter(who => questions.every(q => q.quiz?.solvers?.includes(who)));
  const name = (who: Solver) => {
    const person = people.find(p => p.id === who);
    return who === "owner" ? "the owner" : person ? handleOf(person) : "a guest";
  };
  return all.map(name);
}

// The quiz in the ready check, for anyone on the review. Nothing waits on it: it only says how far its reader has got.
export function QuizBlock({ layer }: { layer: number }) {
  const { request, questions, lapsed, covers } = useQuiz(layer);
  const listening = Boolean(useSession().data?.listening);
  const owner = useIsOwner();
  const solvers = useSolvers(questions);
  if (!request || (questions.length + lapsed === 0 && !owner)) {
    return null;
  }
  const right = questions.filter(q => q.quiz?.answer !== undefined).length;
  const tone = questions.length > 0 && right === questions.length ? "good" : "quiet";
  return (
    <details open data-tone={tone} data-quiz className={BLOCK}>
      <Summary className={BLOCK_TITLE}>
        <ToneDot tone={tone} />
        Check your understanding{questions.length > 0 && ` (${right} of ${questions.length})`}
      </Summary>
      {questions.length + lapsed === 0 && (
        <p className={NOTE}>{listening ? "Claude is writing the questions…" : "Waiting for a session to write the questions."}</p>
      )}
      {covers && questions.length > 0 && <MessageText text={covers.text} layer={layer} className={NOTE} />}
      {lapsed > 0 && (
        <p className={NOTE}>
          {lapsed} {lapsed === 1 ? "question has" : "questions have"} lapsed, since the code {lapsed === 1 ? "it was" : "they were"} about
          has changed.
        </p>
      )}
      {solvers.length > 0 && (
        <p className={NOTE}>
          {solvers.join(", ")} {solvers.length === 1 ? "has" : "have"} every answer right.
        </p>
      )}
      <ol className={cn(BLOCK_LIST, "list-decimal gap-3")}>
        {questions.map(question => (
          <Question key={question.id} question={question} layer={layer} />
        ))}
      </ol>
    </details>
  );
}
