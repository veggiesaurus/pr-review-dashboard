import { describe, expect, spyOn, test } from "bun:test";

import type { Message } from "../shared/messages";
import { GUEST, GUEST_CODE, loaded, rawReview, setup } from "./helpers";

// The PR with a careful-read note on its section, and the same PR after a commit that changes its hunk.
const at = (sig: string, sha: string) => {
  const raw = structuredClone(rawReview);
  raw.meta.headSha = sha.repeat(40);
  Object.assign(raw.files[0]?.hunks[0] ?? {}, { sig });
  Object.assign(raw.sections[0] ?? {}, { risk: "Titles lose a leading tab." });
  return raw;
};
const questions = {
  questions: [
    {
      file: "src/slug.ts",
      line: 2,
      question: "What does a title of a tab and an x become?",
      options: ["x", "a tab and an x", "an error"],
      answer: 0,
      why: "`trim()` takes tabs off as well as spaces.",
    },
    { question: "Which callers change?", options: ["None", "All of them"], answer: 1, why: "Every caller goes through `slug`." },
  ],
};

type Who = (path: string, init?: RequestInit) => Response | Promise<Response>;

// A quiz the owner asked for and the session wrote. The shuffle is held still, so every list of options comes out reversed.
async function quizzed() {
  const made = setup({ raw: at("trim-v1", "a"), load: async () => loaded(at("trim-v2", "c")), guestCode: () => GUEST_CODE });
  const frames: string[] = [];
  made.store.addSessionSink(frame => frames.push(frame));
  const request = (await (await made.page("/api/quiz", made.post({ layer: 12 }))).json()) as Message;
  let next = 1;
  const random = spyOn(Math, "random").mockImplementation(() => (next -= 0.01));
  const written = (await (await made.session("/api/quiz/1/questions", made.post(questions))).json()) as Message[];
  random.mockRestore();
  const shown = async (who: Who) => ((await (await who("/api/messages")).json()) as Message[]).filter(m => m.quiz?.options);
  const pick = async (who: Who, id: string, choice: number) =>
    (await (await who(`/api/quiz/questions/${id}/pick`, made.post({ choice }))).json()) as Message;
  return { ...made, frames, request, written, shown, pick };
}

describe("a quiz on the pull request", () => {
  test("the request tells the session what to ask about and how to hand the questions back", async () => {
    const { frames, request, page, guest, session, post } = await quizzed();
    expect(request).toMatchObject({ id: "m1", from: "user", kind: "chat", quiz: { n: 1 } });
    expect(frames[0]).toStartWith("[review page] quiz 1 requested on acme/shop#12 at aaaaaaa, as chat m1");
    expect(frames[0]).toContain("    - Trim titles: Titles lose a leading tab.");
    expect(frames[0]).toContain("POST /api/quiz/1/questions");
    expect(frames[0]).toContain("Give no answer away");

    // Writing one runs the session, so only the owner may ask, and only the session may hand questions over.
    expect((await guest("/api/quiz", post({ layer: 12 }))).status).toBe(403);
    expect((await session("/api/quiz", post({ layer: 12 }))).status).toBe(403);
    expect((await page("/api/quiz", post({ layer: 99 }))).status).toBe(400);
    expect((await page("/api/quiz/1/questions", post(questions))).status).toBe(403);
    expect((await session("/api/quiz/7/questions", post(questions))).status).toBe(404);
    // An answer has to name one of the options, and no two options may read the same.
    const past = { questions: [{ ...questions.questions[0], answer: 3 }] };
    const twins = { questions: [{ ...questions.questions[0], options: ["x", "x", "an error"] }] };
    expect((await session("/api/quiz/1/questions", post(past))).status).toBe(400);
    expect((await session("/api/quiz/1/questions", post(twins))).status).toBe(400);
  });

  test("the options are shuffled, and the answer still names the right one", async () => {
    const { store, written } = await quizzed();
    const first = store.find(written[0]?.id ?? "")?.quiz;
    expect(first?.options).toEqual(["an error", "a tab and an x", "x"]);
    expect(first?.answer).toBe(2);
    expect(store.find(written[1]?.id ?? "")?.quiz).toMatchObject({ options: ["All of them", "None"], answer: 0 });
  });

  test("a question's answer stays on the server until its reader has picked it", async () => {
    const { written, shown, pick, page, guest, session, post } = await quizzed();
    const [first] = written.map(m => m.id) as [string, string];
    for (const who of [page, guest]) {
      expect((await shown(who)).map(m => m.quiz)).toEqual([
        { n: 1, options: ["an error", "a tab and an x", "x"], picked: [], solvers: [] },
        { n: 1, options: ["All of them", "None"], picked: [], solvers: [] },
      ]);
    }

    // A wrong pick says nothing more, and the right one brings the answer and why.
    expect((await pick(page, first, 0)).quiz).toEqual({ n: 1, options: ["an error", "a tab and an x", "x"], picked: [0], solvers: [] });
    expect((await pick(page, first, 0)).quiz?.picked).toEqual([0]);
    const right = await pick(page, first, 2);
    expect(right.quiz).toMatchObject({ picked: [0, 2], answer: 2, why: "`trim()` takes tabs off as well as spaces." });
    // Nothing more is kept once it is right.
    expect((await pick(page, first, 1)).quiz?.picked).toEqual([0, 2]);
    expect((await shown(page))[0]?.quiz).toMatchObject({ picked: [0, 2], answer: 2 });

    for (const bad of [`/api/quiz/questions/${first}/pick`, "/api/quiz/questions/m1/pick", "/api/quiz/questions/m99/pick"]) {
      expect((await page(bad, post({ choice: 3 }))).status).toBe(404);
    }
    expect((await page(`/api/quiz/questions/${first}/pick`, post({ choice: 5 }))).status).toBe(400);
    expect((await session(`/api/quiz/questions/${first}/pick`, post({ choice: 0 }))).status).toBe(403);
  });

  test("others see who has a question right, never what anyone picked", async () => {
    const { written, shown, pick, page, guest } = await quizzed();
    const [first] = written.map(m => m.id) as [string, string];
    await pick(page, first, 0);
    await pick(page, first, 2);
    await pick(guest, first, 1);
    expect((await shown(page))[0]?.quiz?.solvers).toEqual([]);

    const theirs = (await shown(guest))[0]?.quiz;
    expect(theirs).toEqual({ n: 1, options: ["an error", "a tab and an x", "x"], picked: [1], solvers: ["owner"] });
    await pick(guest, first, 2);
    expect((await shown(page))[0]?.quiz).toMatchObject({ picked: [0, 2], solvers: [GUEST.id] });
    expect((await shown(guest))[0]?.quiz).toMatchObject({ picked: [1, 2], answer: 2, solvers: ["owner"] });
  });

  test("a question lapses when its hunk changes, and one about the whole change stays", async () => {
    const { store, review, written } = await quizzed();
    // The line itself reads the same after the rebuild; it is the hunk around it that changed.
    await review.reload();
    expect(store.find(written[0]?.id ?? "")?.anchor).toMatchObject({ kind: "hunk", outdated: true });
    expect(store.find(written[1]?.id ?? "")?.anchor.outdated).toBeUndefined();
  });
});
