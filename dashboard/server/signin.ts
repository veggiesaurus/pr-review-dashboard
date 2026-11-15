import { randomBytes } from "node:crypto";

import { z } from "zod";
import type { SignInStatus } from "../shared/messages";
import { REPO, type Runner } from "./comments";
import { LOGIN } from "./github";

// The OAuth app guests sign in with, which PRG_GITHUB_CLIENT_ID overrides. Empty until it is registered.
export const DEFAULT_GITHUB_CLIENT_ID = "";

const KEEP_MS = 15 * 60_000;

const deviceSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  expires_in: z.number(),
  interval: z.number(),
});
const answerSchema = z.object({ access_token: z.string().optional(), error: z.string().optional() });
const userSchema = z.object({ id: z.number().int(), login: z.string().regex(LOGIN), name: z.string().nullable(), avatar_url: z.string() });

// GitHub's device flow with no scope: the token only ever reads who signed in, and is dropped once it has.
export class SignIn {
  private readonly statuses = new Map<string, { status: SignInStatus; at: number }>();

  constructor(
    private readonly opts: {
      clientId: string;
      fetcher: typeof fetch;
      runner: Runner;
      repo: () => string;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {}

  get clientId() {
    return this.opts.clientId;
  }

  async start(): Promise<{ id: string } & SignInStatus> {
    for (const [id, kept] of this.statuses) {
      if (Date.now() - kept.at >= KEEP_MS) {
        this.statuses.delete(id);
      }
    }
    const id = randomBytes(24).toString("hex");
    const device = deviceSchema.safeParse(await this.post("https://github.com/login/device/code", {}).catch(() => null));
    if (!device.success) {
      return { id, ...this.set(id, { state: "failed", reason: "error" }) };
    }
    const { user_code, verification_uri, expires_in } = device.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();
    const pending = this.set(id, { state: "pending", userCode: user_code, verificationUri: verification_uri, expiresAt });
    void this.poll(device.data).then(
      status => this.set(id, status),
      () => this.set(id, { state: "failed", reason: "error" }),
    );
    return { id, ...pending };
  }

  status(id: string) {
    const kept = this.statuses.get(id);
    return kept && Date.now() - kept.at < KEEP_MS ? kept.status : null;
  }

  private set(id: string, status: SignInStatus) {
    this.statuses.set(id, { status, at: Date.now() });
    return status;
  }

  private async post(url: string, fields: Record<string, string>): Promise<unknown> {
    const response = await this.opts.fetcher(url, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({ client_id: this.opts.clientId, ...fields }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.json();
  }

  private async poll(device: z.infer<typeof deviceSchema>): Promise<SignInStatus> {
    const sleep = this.opts.sleep ?? Bun.sleep;
    const deadline = Date.now() + device.expires_in * 1000;
    let interval = device.interval * 1000;
    let token: string | undefined;
    while (!token) {
      if (Date.now() > deadline) {
        return { state: "failed", reason: "expired" };
      }
      await sleep(interval);
      const fields = { device_code: device.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" };
      const answer = answerSchema.parse(await this.post("https://github.com/login/oauth/access_token", fields));
      if (answer.access_token) {
        token = answer.access_token;
      } else if (answer.error === "slow_down") {
        interval += 5000;
      } else if (answer.error === "expired_token") {
        return { state: "failed", reason: "expired" };
      } else if (answer.error === "access_denied") {
        return { state: "failed", reason: "denied" };
      } else if (answer.error !== "authorization_pending") {
        return { state: "failed", reason: "error" };
      }
    }

    const response = await this.opts.fetcher("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "pr-review-dashboard" },
      signal: AbortSignal.timeout(10_000),
    });
    const user = userSchema.parse(await response.json());
    const repo = this.opts.repo();
    if (!REPO.test(repo)) {
      return { state: "failed", reason: "error" };
    }
    const checked = await this.opts.runner(["gh", "api", `repos/${repo}/collaborators/${user.login}`], process.cwd());
    if (checked.code !== 0) {
      return { state: "failed", reason: "not-collaborator" };
    }
    return { state: "done", person: { id: user.id, login: user.login, name: user.name, avatar: user.avatar_url } };
  }
}
