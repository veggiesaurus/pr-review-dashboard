import type { ReactNode } from "react";
import type { Anchor } from "shared/messages";
import type { Annotation, Tell } from "shared/payload";
import { prKey, TICK_PREFIX } from "shared/ticks";

import { AskClaude } from "src/components/chat/AskClaude";
import { ReviewBlock, ReviewButton } from "src/components/chat/Review";
import { Prose } from "src/components/links/Prose";
import { BLOCK, BLOCK_LIST, BLOCK_TITLE, Block, Summary } from "src/components/ui/disclosure";
import { useLayer } from "src/queries/review.query";
import { useSetTicks, useTicks } from "src/queries/ticks.query";
import { useViewStore } from "src/store/view.store";
import { formatHash } from "src/utils/anchors";
import { cn } from "src/utils/cn";
import { indexLayer } from "src/utils/payload";

const REF =
  "cursor-pointer underline decoration-dotted decoration-muted-foreground underline-offset-[3px] hover:text-primary hover:decoration-primary";
const TELL_REF = `${REF} font-mono text-xs`;
const MORE_SHOWN = 8;
const ELSEWHERE_SHOWN = 12;

const pad2 = (n: number) => String(n).padStart(2, "0");

const Muted = ({ children }: { children: ReactNode }) => <span className="text-muted-foreground">{children}</span>;
const StackNote = ({ note }: { note?: string }) => (note ? <Muted> {note}</Muted> : null);

// A link and its Ask Claude button, kept on one line.
function Ref({ label, title, onClick, anchor }: { label: string; title?: string; onClick: () => void; anchor?: Anchor }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1 whitespace-nowrap", anchor && "mr-2.5")}>
      <button type="button" className={TELL_REF} title={title} onClick={onClick}>
        {label}
      </button>
      {anchor && <AskClaude anchor={anchor} className="self-center" />}
    </span>
  );
}

function byFile<T extends { file?: string }>(list: T[]) {
  const out = new Map<string, T[]>();
  for (const item of list) {
    const key = item.file ?? "";
    out.set(key, [...(out.get(key) ?? []), item]);
  }
  return [...out];
}

function More({ count }: { count: number }) {
  return count > MORE_SHOWN ? <Muted>and {count - MORE_SHOWN} more</Muted> : null;
}

// "Before you mark it ready": the template's lists under its chips, which here sit in the header.
export function ReadyCheck({ layer }: { layer: number }) {
  const shown = useLayer(layer);
  const goTo = useViewStore(state => state.goTo);
  const ticked = useTicks();
  const setTicks = useSetTicks();
  if (!shown) {
    return null;
  }
  // By the step's own words, so it stays ticked across rebuilds for as long as the guide says the same thing.
  const tryKey = (step: string) => `${TICK_PREFIX}${prKey(shown.meta)}:try:${step.slice(0, 300)}`;
  const { tells, annotations, descriptionCheck: desc, sections, split } = shown;
  const { files, hunks: hunkIndex, owner } = indexLayer(shown);
  const path = (id: string) => files.get(id)?.path ?? id;
  const go = (target: string) => () => goTo(layer, target);

  // Hunks named by the section they show in, one link per section; a hunk outside the guide's sections keeps its id.
  const hunkLinks = (hunks: string[] = []) => {
    const seen = new Map<string, string>();
    for (const hunk of hunks) {
      const at = owner.get(hunk);
      const label = at !== undefined && sections[at]?.kind === "guide" ? `§${pad2(at + 1)}` : hunk;
      if (!seen.has(label)) {
        seen.set(label, hunk);
      }
    }
    return [...seen].map(([label, hunk], i) => (
      <span key={label}>
        {i > 0 && " "}
        <Ref label={label} title={hunkIndex.get(hunk)?.file.path} onClick={go(hunk)} />
      </span>
    ));
  };
  const claim = (list: "checklist" | "unsupported" | "missing" | "issue", index: number): Anchor => ({ kind: "claim", layer, list, index });

  const placed = annotations.flatMap((note, index) => (note.row && note.file ? [{ ...note, index }] : []));
  const elsewhere = annotations.flatMap((note, index) => (note.row ? [] : [{ ...note, index }]));
  const carried = desc?.checklist ?? [];
  const unsupported = desc?.unsupported ?? [];
  const missing = desc?.missing ?? [];
  const issueAsks = desc?.issue ?? [];
  const risky = sections.flatMap((section, index) => (section.kind === "guide" && section.risk ? [{ section, index }] : []));
  // A real link: it wraps like the text around it, where a button wraps as a block, and it opens in a new tab.
  const sectionLink = (n: number) => (
    <a
      key={n}
      href={formatHash(layer, "guide", `s${n}`)}
      className={REF}
      onClick={event => {
        event.preventDefault();
        goTo(layer, `s${n}`);
      }}
    >
      §{pad2(n)} {sections[n - 1]?.title}
    </a>
  );

  const blocks: ReactNode[] = [];
  if (tells.length) {
    blocks.push(
      <Block key="tells" title="Flagged lines">
        {byFile<Tell>(tells).map(([file, list]) => (
          <li key={file}>
            <code className="mr-2 font-mono text-xs">{path(file)}</code>
            {list.slice(0, MORE_SHOWN).map(tell => (
              <Ref
                key={`${tell.line}:${tell.kind}`}
                label={`${tell.label} ${tell.line}`}
                title={tell.text}
                onClick={go(`${tell.hunk}:${tell.line}`)}
                anchor={{ kind: "tell", layer, file: tell.file, line: tell.line }}
              />
            ))}
            <More count={list.length} />
          </li>
        ))}
      </Block>,
    );
  }
  if (annotations.length) {
    blocks.push(
      <details key="annotations" open className={BLOCK}>
        <Summary className={BLOCK_TITLE}>CI annotations</Summary>
        {placed.length > 0 && (
          <ul className={BLOCK_LIST}>
            {byFile<Annotation & { index: number }>(placed).map(([file, list]) => (
              <li key={file}>
                <code className="mr-2 font-mono text-xs">{path(file)}</code>
                {list.slice(0, MORE_SHOWN).map(note => (
                  <Ref
                    key={note.index}
                    label={`${note.title || note.level} ${note.row}`}
                    title={note.message}
                    onClick={go(`${note.hunk}:${note.row}`)}
                    anchor={{ kind: "annotation", layer, index: note.index }}
                  />
                ))}
                <More count={list.length} />
              </li>
            ))}
          </ul>
        )}
        {elsewhere.length > 0 && (
          <>
            <p className="mt-1.5 text-[13.5px] text-muted-foreground">
              {elsewhere.length} on lines this PR doesn't change{elsewhere.length > ELSEWHERE_SHOWN && ", the first 12 here"}:
            </p>
            <ul className={BLOCK_LIST}>
              {elsewhere.slice(0, ELSEWHERE_SHOWN).map(note => (
                <li key={note.index}>
                  <code className="font-mono text-xs">
                    {note.path}:{note.line}
                  </code>{" "}
                  {note.title || note.level}: <Muted>{note.message}</Muted>
                  <AskClaude anchor={{ kind: "annotation", layer, index: note.index }} className="ml-1 align-middle" />
                </li>
              ))}
            </ul>
          </>
        )}
      </details>,
    );
  }
  // Only where the description or the linked issue and the diff disagree; what the diff does carry out comes last, folded.
  if (unsupported.length || missing.length) {
    blocks.push(
      <Block key="description" title="Description vs diff">
        {unsupported.map((row, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: findings have no id and keep their order
          <li key={`u${index}`}>
            <b className="font-semibold">Not in the diff:</b> <q className="italic">{row.claim}</q> <Muted>{row.why}</Muted>
            <StackNote note={row.stack} />
            <AskClaude anchor={claim("unsupported", index)} className="ml-1 align-middle" />
          </li>
        ))}
        {missing.map((row, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: findings have no id and keep their order
          <li key={`m${index}`}>
            <b className="font-semibold">Left out:</b> {row.what} {hunkLinks(row.hunks)}
            <StackNote note={row.stack} />
            <AskClaude anchor={claim("missing", index)} className="ml-1 align-middle" />
          </li>
        ))}
      </Block>,
    );
  }
  if (issueAsks.length) {
    blocks.push(
      <Block key="issue" title="Linked issue vs diff">
        {issueAsks.map((row, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: findings have no id and keep their order
          <li key={`i${index}`}>
            <b className="font-semibold">Not in the diff:</b> {row.ask} <Muted>{row.why}</Muted>
            <StackNote note={row.stack} />
            <AskClaude anchor={claim("issue", index)} className="ml-1 align-middle" />
          </li>
        ))}
      </Block>,
    );
  }
  if (risky.length) {
    blocks.push(
      <Block key="risky" title="Needs a careful read">
        {risky.map(({ section, index }) => (
          <li key={index}>
            {sectionLink(index + 1)}: {section.kind === "guide" && section.risk}
            <AskClaude anchor={{ kind: "section", layer, index }} className="ml-1 align-middle" />
          </li>
        ))}
      </Block>,
    );
  }
  if (shown.try.length) {
    blocks.push(
      <Block key="try" title={`Try by hand (${shown.try.filter(step => ticked(tryKey(step))).length} of ${shown.try.length})`}>
        {shown.try.map((step, index) => (
          <li key={step} className="-ml-5 flex list-none items-start gap-2">
            <input
              type="checkbox"
              data-tick="try"
              checked={ticked(tryKey(step))}
              onChange={event => setTicks([tryKey(step)], event.target.checked)}
              aria-label={`Tried step ${index + 1}`}
              className="motion-tick mt-1 accent-primary"
            />
            <span className={cn(ticked(tryKey(step)) && "text-muted-foreground")}>
              <Prose text={step} layer={layer} />
              <AskClaude anchor={{ kind: "try", layer, index }} className="ml-1 align-middle" />
            </span>
          </li>
        ))}
      </Block>,
    );
  }
  if (split) {
    blocks.push(
      <Block
        key="split"
        title={`Could be ${split.prs.length} PRs`}
        note={split.note && <p className="mt-1.5 text-[13.5px] text-muted-foreground">{split.note}</p>}
      >
        {split.prs.map((pr, k) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the split's PRs are in a fixed order
          <li key={k}>
            PR {k + 1}:{" "}
            {pr.map((n, i) => (
              <span key={n}>
                {i > 0 && ", "}
                {sectionLink(n)}
              </span>
            ))}
          </li>
        ))}
      </Block>,
    );
  }
  if (carried.length) {
    blocks.push(
      <Block key="carried" title={`What the diff carries out (${carried.length})`} open={false}>
        {carried.map((row, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: findings have no id and keep their order
          <li key={index}>
            {row.from === "issue" && <b className="font-semibold">Issue: </b>}
            <q className="italic">{row.claim}</q> {hunkLinks(row.hunks)}
            <StackNote note={row.stack} />
            <AskClaude anchor={claim("checklist", index)} className="ml-1 align-middle" />
          </li>
        ))}
      </Block>,
    );
  }

  return (
    <section className="grid gap-2.5" aria-label="Before you mark it ready">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="font-serif text-xl">Before you mark it ready</h2>
        <ReviewButton layer={layer} />
      </div>
      <ReviewBlock layer={layer} />
      {blocks.length ? blocks : <p className="text-muted-foreground text-sm">Nothing more to settle than the chips above say.</p>}
    </section>
  );
}
