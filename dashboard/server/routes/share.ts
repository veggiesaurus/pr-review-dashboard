import { Hono } from "hono";

import { guestAnswerSchema, type ShareInfo } from "../../shared/messages";
import type { AppDeps } from "../app";
import { reviewedRepo } from "../comments";
import { run } from "../exec";
import { type Env, only, small } from "../guards";

export function shareRoutes(deps: AppDeps) {
  const { share, people, review, signIn } = deps;
  const app = new Hono<Env>();

  const info = (): ShareInfo => ({
    sharing: share.link !== null,
    link: share.link,
    signedIn: people.signedIn(),
    waiting: signIn.waiting().map(guest => ({ ...guest, alreadyIn: people.signedIn().some(person => person.id === guest.person.id) })),
    unpushed: review.response.layers.some(layer => !layer.meta.number || layer.meta.checks?.stale),
    blocked: blocked(),
  });

  // What stops sharing, as far as can be known without asking GitHub, so the page can say so before Start.
  function blocked() {
    if (!signIn.clientId) {
      return "sharing needs a GitHub OAuth app of your own for guests to sign in with: register one at https://github.com/settings/applications/new with Enable Device Flow ticked, then put its client id in the plugin's settings (/plugin configure pr-review-dashboard@pr-review-dashboard) or PRG_GITHUB_CLIENT_ID";
    }
    if (!people.owner) {
      return "sharing needs your GitHub login to check who may sign in, and gh api user failed when the dashboard started: check gh auth status, then start it again";
    }
    if (!reviewedRepo(review)) {
      return "sharing needs the review's GitHub repo, to check who may sign in, and this review has none";
    }
    return share.missing;
  }

  // Only collaborators on the reviewed repo may sign in, which only someone with push access to it can check.
  async function cannotCheck() {
    const early = blocked();
    const repo = reviewedRepo(review);
    if (early || !repo || !people.owner) {
      return early;
    }
    const checked = await (deps.runner ?? run)(["gh", "api", `repos/${repo}/collaborators/${people.owner.login}`], deps.repo).catch(
      () => null,
    );
    if (checked?.code !== 0) {
      const why = checked ? checked.stderr.trim().split("\n")[0] || `gh exited ${checked.code}` : "gh didn't run";
      return `sharing lets in only collaborators on ${repo}, and your gh can't check who they are (${why}): it needs push access to ${repo}`;
    }
    return null;
  }

  app.get("/share", only("owner"), c => c.json(info()));

  app.post("/share", only("owner", "session"), async c => {
    const refused = await cannotCheck();
    if (refused) {
      return c.json({ error: refused }, 400);
    }
    const started = await share.start();
    return "error" in started ? c.json(started, 400) : c.json(info());
  });

  app.delete("/share", only("owner", "session"), c => {
    share.stop();
    return c.json(info());
  });

  app.post("/share/guests/:id", only("owner"), small, async c => {
    const body = guestAnswerSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: "say whether to let them in" }, 400);
    }
    if (!signIn.answer(c.req.param("id"), body.data.allow)) {
      return c.json({ error: "no guest is waiting with that id" }, 404);
    }
    return c.json(info());
  });

  return app;
}
