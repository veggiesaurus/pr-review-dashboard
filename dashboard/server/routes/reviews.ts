import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import {
  findingsSchema,
  pickSchema,
  questionsSchema,
  quizRequestSchema,
  reviewRequestSchema,
  triesRequestSchema,
} from "../../shared/messages";
import type { AppDeps } from "../app";
import { type Env, only, small } from "../guards";

const number = (param: string) => (/^\d{1,9}$/.test(param) ? Number(param) : 0);

export function reviewsRoutes({ store }: AppDeps) {
  const app = new Hono<Env>();

  // The user asks Claude to review one PR; the request is a thread, and the session is told how to answer.
  app.post("/reviews", only("owner"), small, zValidator("json", reviewRequestSchema), c => {
    const { layer, effort } = c.req.valid("json");
    const request = store.requestReview(layer, effort);
    return request ? c.json(request, 201) : c.json({ error: "that pull request isn't in this review" }, 400);
  });

  // The session hands over what the review found; each finding becomes a thread Claude starts.
  app.post("/reviews/:n/findings", only("session"), small, zValidator("json", findingsSchema), c => {
    store.heard();
    const threads = store.addFindings(number(c.req.param("n")), c.req.valid("json").findings);
    return threads ? c.json(threads, 201) : c.json({ error: "no review with that number" }, 404);
  });

  // The user asks for every recommended finding still open to be fixed; they go to the session in one frame.
  app.post("/reviews/:n/fix", only("owner"), c => {
    const sent = store.fixRecommended(number(c.req.param("n")));
    return sent === null ? c.json({ error: "no review with that number" }, 404) : c.json({ sent });
  });

  app.post("/reviews/:n/archive", only("owner"), c => {
    const archived = store.archiveReview(number(c.req.param("n")));
    return archived ? c.json({ archived }) : c.json({ error: "no review with that number" }, 404);
  });

  // The user asks Claude to try the guide's steps by hand; what happened comes back as replies on each step's thread.
  app.post("/tries", only("owner"), small, zValidator("json", triesRequestSchema), c => {
    const sent = store.requestTries(c.req.valid("json").layer);
    return sent === null ? c.json({ error: "that pull request isn't in this review" }, 400) : c.json({ sent });
  });

  // The owner asks Claude for a quiz on one PR; the request is a thread, and the session is told what to write.
  app.post("/quiz", only("owner"), small, zValidator("json", quizRequestSchema), c => {
    const request = store.requestQuiz(c.req.valid("json").layer);
    return request ? c.json(request, 201) : c.json({ error: "that pull request isn't in this review" }, 400);
  });

  // The session hands over the questions; each becomes a thread, whose answer no page is sent before it has picked it.
  app.post("/quiz/:n/questions", only("session"), small, zValidator("json", questionsSchema), c => {
    store.heard();
    const threads = store.addQuestions(number(c.req.param("n")), c.req.valid("json").questions);
    return threads ? c.json(threads, 201) : c.json({ error: "no quiz with that number" }, 404);
  });

  // Anyone on the review picks an option; the question comes back as they may now see it.
  app.post("/quiz/questions/:id/pick", only("owner", "guest"), small, zValidator("json", pickSchema), c => {
    const question = store.pick(c.req.param("id"), c.req.valid("json").choice, c.get("author"));
    return question ? c.json(question) : c.json({ error: "no question with that id, or no such option" }, 404);
  });

  return app;
}
