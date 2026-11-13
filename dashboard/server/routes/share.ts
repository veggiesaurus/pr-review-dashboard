import { Hono } from "hono";

import type { ShareInfo } from "../../shared/messages";
import type { AppDeps } from "../app";
import { REPO } from "../comments";
import { run } from "../exec";
import { type Env, only } from "../guards";

export function shareRoutes(deps: AppDeps) {
  const { share, people, review } = deps;
  const app = new Hono<Env>();

  const info = (): ShareInfo => ({
    sharing: share.link !== null,
    link: share.link,
    signedIn: people.signedIn(),
    unpushed: review.response.layers.some(layer => !layer.meta.number || layer.meta.checks?.stale),
  });

  // Only collaborators on the reviewed repo may sign in, which only someone with push access to it can check.
  async function cannotCheck() {
    const { stack, layers } = review.response;
    const repo = [layers[0]?.meta.repo, stack?.repo].find(name => name && REPO.test(name));
    if (!people.owner) {
      return "sharing needs your GitHub login to check who may sign in, and gh api user failed when the dashboard started: check gh auth status, then start it again";
    }
    if (!repo) {
      return "sharing needs the review's GitHub repo, to check who may sign in, and this review has none";
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

  // A new share has a new tunnel host, which the old one's cookies never reach, so its guests sign in again anyway.
  app.delete("/share", only("owner", "session"), c => {
    share.stop();
    people.revokeAll();
    return c.json(info());
  });

  return app;
}
