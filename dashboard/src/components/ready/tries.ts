import type { Message } from "shared/messages";
import type { SectionFile } from "shared/payload";
import { awaitsTry } from "shared/tries";

// What Claude last found when it tried a step, and whether an ask to try it still waits.
export function stepEvidence(messages: Message[], layer: number, index: number) {
  const onStep = messages.filter(
    m => m.anchor.kind === "try" && m.anchor.layer === layer && m.anchor.index === index && !m.anchor.outdated,
  );
  return {
    answer: onStep.findLast(m => m.tried),
    waiting: onStep.some(awaitsTry),
  };
}

// The steps whose links point into a section's cards, by their place in the guide's list. A link to a whole file
// counts wherever a part of that file is; a link into another layer of a stack doesn't.
export function stepsFor(steps: string[], parts: SectionFile[]): number[] {
  const here = (ref: string) => (ref.includes("h") ? parts.some(part => part.hunks.includes(ref)) : parts.some(part => part.id === ref));
  return steps.flatMap((step, at) => ([...step.matchAll(/\]\((f\d+(?:h\d+)?)\)/g)].some(link => here(link[1] ?? "")) ? [at] : []));
}
