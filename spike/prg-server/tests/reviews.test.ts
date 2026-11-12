import { describe, expect, test } from "bun:test";

import type { Message } from "../shared/messages";
import { loaded, rawReview, setup } from "./helpers";

// The PR with its hunk's signature, and the same PR after a commit that changes that hunk.
const withSig = (sig: string, sha: string) => {
  const raw = structuredClone(rawReview);
  raw.meta.headSha = sha.repeat(40);
  Object.assign(raw.files[0]?.hunks[0] ?? {}, { sig });
  return raw;
};
const first = withSig("trim-v1", "a");
const fixed = withSig("trim-v2", "c");

const findings = {
  findings: [
    {
      file: "src/slug.ts",
      line: 2,
      summary: "trim() drops a leading tab too",
      failure_scenario: "A title of '\\tx' loses its tab.",
      severity: "high",
      recommended: true,
    },
    { file: "./src/slug.ts", line: "3", summary: "the brace is fine" },
    { file: "src/slug.ts", line: 90, summary: "past the end of the file" },
    { file: "src/other.ts", line: 4, summary: "a caller the diff doesn't touch" },
  ],
};

async function reviewed() {
  const made = setup({ raw: first, load: async () => loaded(fixed) });
  const frames: string[] = [];
  made.store.addSessionSink(frame => frames.push(frame));
  const request = (await (await made.page("/api/reviews", made.post({ layer: 12, effort: "xhigh" }))).json()) as Message;
  const threads = (await (await made.session("/api/reviews/1/findings", made.post(findings))).json()) as Message[];
  return { ...made, frames, request, threads };
}

describe("a review asked for from the page", () => {
  test("the request tells the session what to run and how to hand the findings back", async () => {
    const { frames, request, page, session, post } = await reviewed();
    expect(request).toMatchObject({ id: "m1", from: "user", kind: "chat", review: { n: 1, effort: "xhigh" }, status: "delivered" });
    expect(frames[0]).toStartWith("[review page] review 1 requested on acme/shop#12 at aaaaaaa, as chat m1");
    expect(frames[0]).toContain("/code-review xhigh #12");
    expect(frames[0]).toContain("Don't pass --comment or --fix");
    expect(frames[0]).toContain("POST /api/reviews/1/findings");

    expect((await page("/api/reviews", post({ layer: 12, effort: "max" }))).status).toBe(400);
    expect((await page("/api/reviews", post({ layer: 99, effort: "low" }))).status).toBe(400);
    expect((await session("/api/reviews", post({ layer: 12, effort: "low" }))).status).toBe(403);
    expect((await page("/api/reviews/1/findings", post(findings))).status).toBe(403);
    expect((await session("/api/reviews/7/findings", post(findings))).status).toBe(404);
  });

  test("each finding is a thread Claude starts, on its line when the diff can show it", async () => {
    const { threads } = await reviewed();
    expect(threads.map(t => [t.id, t.from, t.anchor.kind, t.anchor.loc, t.review?.recommended ?? false])).toEqual([
      ["m2", "claude", "line", "src/slug.ts:R2@aaaaaaa", true],
      ["m3", "claude", "line", "src/slug.ts:R3@aaaaaaa", false],
      ["m4", "claude", "file", "src/slug.ts@aaaaaaa", false],
      ["m5", "claude", "general", null, false],
    ]);
    expect(threads.map(t => t.review?.severity)).toEqual(["high", undefined, undefined, undefined]);
    expect(threads[0]?.text).toBe("trim() drops a leading tab too\n\nA title of '\\tx' loses its tab.");
    expect(threads[2]?.text).toBe("src/slug.ts:90: past the end of the file");
    expect(threads[3]?.text).toBe("src/other.ts:4: a caller the diff doesn't touch");
    expect(threads.every(t => t.review?.n === 1 && t.status === "delivered" && t.state === "open")).toBe(true);
  });

  test("asking for a fix quotes the finding, and the whole review archives at once", async () => {
    const { store, frames, page, post } = await reviewed();
    await page("/api/messages", post({ kind: "chat", text: "Fix this.", replyTo: "m2" }));
    expect(frames.at(-1)).toStartWith("[review page] chat m6 on acme/shop#12 at aaaaaaa, following up on m2");
    expect(frames.at(-1)).toContain("    the finding: trim() drops a leading tab too");

    expect(await (await page("/api/reviews/1/archive", { method: "POST" })).json()).toEqual({ archived: 5 });
    expect(store.messages.filter(m => !m.replyTo).every(m => m.archived)).toBe(true);
    expect((await page("/api/reviews/2/archive", { method: "POST" })).status).toBe(404);
  });

  test("after a rebuild, open findings whose code changed go back to the session once", async () => {
    const { store, review, frames, session, post } = await reviewed();
    await session("/api/replies", post({ replyTo: "m3", state: "done", text: "Nothing to do." }));
    frames.length = 0;
    await review.reload();

    expect(frames).toHaveLength(1);
    expect(frames[0]).toStartWith("[review page] re-check 3 review findings on acme/shop#12 at ccccccc");
    expect(frames[0]).toContain("m2 about src/slug.ts:R2@ccccccc");
    expect(frames[0]).not.toContain("m3 about");
    expect(frames[0]).toContain("m5 about");
    expect(store.find("m2")?.events?.map(event => event.text)).toEqual(["Sent back to Claude after a rebuild"]);

    await session("/api/replies", post({ replyTo: "m2", state: "done", text: "The trim is now only of spaces." }));
    expect(store.find("m2")).toMatchObject({ state: "done", resolved: true });
    frames.length = 0;
    await review.reload();
    expect(frames).toEqual([]);
  });
});
