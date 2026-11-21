import { randomBytes, randomInt } from "node:crypto";

import { z } from "zod";
import type { Person, SignInStatus, WaitingGuest } from "../shared/messages";
import { REPO, type Runner } from "./comments";
import { LOGIN } from "./github";

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

type From = { country: string | null; browser: string | null };
type Failed = Extract<SignInStatus, { state: "failed" }>;

const OS = [
  [/iPhone|iPad/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux|X11/, "Linux"],
] as const;
const BROWSERS = [
  [/Edg\//, "Edge"],
  [/Firefox\/|FxiOS/, "Firefox"],
  [/Chrome\/|CriOS/, "Chrome"],
  [/Safari\//, "Safari"],
] as const;

export function browserOf(userAgent: string | undefined): string | null {
  const os = OS.find(([pattern]) => pattern.test(userAgent ?? ""))?.[1];
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent ?? ""))?.[1];
  return os && browser ? `${browser} on ${os}` : null;
}

// GitHub's device flow with no scope: the token only ever reads who signed in, and is dropped once it has.
// Without a client id a guest types a name instead. Either way they wait for the owner, who checks their code.
export class SignIn {
  private readonly statuses = new Map<string, { status: SignInStatus; at: number; claimed?: boolean }>();
  private readonly dropped = new Set<string>();
  private readonly guests = new Map<string, Omit<WaitingGuest, "alreadyIn" | "person" | "code">>();

  constructor(
    private readonly opts: {
      clientId: string;
      fetcher: typeof fetch;
      runner: Runner;
      repo: () => string;
      sleep?: (ms: number) => Promise<void>;
      onChange?: () => void;
    },
  ) {}

  get clientId() {
    return this.opts.clientId;
  }

  async start(from?: From): Promise<{ id: string } & SignInStatus> {
    this.forget();
    const id = randomBytes(24).toString("hex");
    const device = deviceSchema.safeParse(await this.post("https://github.com/login/device/code", {}).catch(() => null));
    if (!device.success) {
      return { id, ...this.set(id, { state: "failed", reason: "error" }) };
    }
    const { user_code, verification_uri, expires_in } = device.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();
    const pending = this.set(id, { state: "pending", userCode: user_code, verificationUri: verification_uri, expiresAt });
    void this.poll(device.data).then(
      result => {
        if (this.dropped.delete(id)) {
          return;
        }
        if ("state" in result) {
          this.set(id, result);
        } else {
          this.wait(id, result, from);
        }
      },
      () => {
        if (!this.dropped.delete(id)) {
          this.set(id, { state: "failed", reason: "error" });
        }
      },
    );
    return { id, ...pending };
  }

  // Nothing checks the name is theirs: the owner's answer, and the code they check with the guest, are the only gate.
  named(name: string, from?: From): { id: string } & SignInStatus {
    this.forget();
    const id = randomBytes(24).toString("hex");
    return { id, ...this.wait(id, { id: -randomInt(1, 2 ** 47), login: "", name, avatar: "" }, from) };
  }

  status(id: string) {
    this.lapse();
    const kept = this.statuses.get(id);
    return kept && Date.now() - kept.at < KEEP_MS ? kept.status : null;
  }

  // A finished sign-in gives its guest one session, so its id can't sign them in again after sharing stops.
  claim(id: string): Person | null {
    const kept = this.statuses.get(id);
    if (!kept || kept.claimed || kept.status.state !== "done" || Date.now() - kept.at >= KEEP_MS) {
      return null;
    }
    kept.claimed = true;
    return kept.status.person;
  }

  // Sign-ins not yet answered: still on GitHub's page, or waiting for the owner.
  open() {
    this.lapse();
    this.forget();
    return [...this.statuses.values()].filter(({ status }) => status.state === "pending" || status.state === "waiting").length;
  }

  waiting(): Omit<WaitingGuest, "alreadyIn">[] {
    this.lapse();
    return [...this.guests].flatMap(([sid, guest]) => {
      const status = this.statuses.get(sid)?.status;
      return status?.state === "waiting" ? [{ ...guest, person: status.person, code: status.code }] : [];
    });
  }

  answer(handle: string, allow: boolean) {
    this.lapse();
    const found = [...this.guests].find(([, guest]) => guest.id === handle);
    const status = found && this.statuses.get(found[0])?.status;
    if (!found || status?.state !== "waiting") {
      return false;
    }
    this.guests.delete(found[0]);
    this.set(found[0], allow ? { state: "done", person: status.person } : { state: "failed", reason: "turned-away" });
    this.opts.onChange?.();
    return true;
  }

  // Sharing stopped: nothing started under it signs anyone in, even a sign-in the owner already let through.
  dropWaiting() {
    for (const [sid, kept] of this.statuses) {
      if (kept.status.state === "pending") {
        this.dropped.add(sid);
      }
      if (kept.status.state === "pending" || kept.status.state === "done") {
        this.set(sid, { state: "failed", reason: "expired" });
      }
    }
    for (const sid of this.guests.keys()) {
      this.set(sid, { state: "failed", reason: "expired" });
    }
    this.guests.clear();
  }

  private lapse() {
    for (const sid of this.guests.keys()) {
      const kept = this.statuses.get(sid);
      if (!kept || Date.now() - kept.at >= KEEP_MS) {
        this.guests.delete(sid);
        this.set(sid, { state: "failed", reason: "expired" });
        this.opts.onChange?.();
      }
    }
  }

  private wait(sid: string, person: Person, from?: From) {
    this.guests.set(sid, {
      id: randomBytes(12).toString("hex"),
      country: from?.country ?? null,
      browser: from?.browser ?? null,
      at: new Date().toISOString(),
    });
    const status = this.set(sid, { state: "waiting", person, code: randomInt(0, 10_000).toString().padStart(4, "0") });
    this.opts.onChange?.();
    return status;
  }

  private forget() {
    for (const [id, kept] of this.statuses) {
      if (Date.now() - kept.at >= KEEP_MS) {
        this.statuses.delete(id);
      }
    }
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

  private async poll(device: z.infer<typeof deviceSchema>): Promise<Person | Failed> {
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
    return { id: user.id, login: user.login, name: user.name, avatar: user.avatar_url };
  }
}
