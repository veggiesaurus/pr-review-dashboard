import { randomBytes } from "node:crypto";

import type { Runner } from "./comments";
import { childEnv, run } from "./exec";
import type { People } from "./people";

export type Spawn = (cmd: string[]) => { stderr: ReadableStream<Uint8Array>; exited: Promise<number>; kill(): void };
type Tunnel = ReturnType<Spawn>;

// api.trycloudflare.com is where cloudflared asks for a tunnel, so it shows up in its errors.
const TUNNEL_URL = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;
const INSTALL = "install cloudflared (brew install cloudflared, or https://github.com/cloudflare/cloudflared/releases)";

const spawnTunnel: Spawn = cmd => Bun.spawn(cmd, { env: childEnv(), stdin: "ignore", stdout: "ignore", stderr: "pipe" });

// Resolves with the tunnel's host once cloudflared prints it, or null if its stderr ends first. It reads on to the
// end either way, since cloudflared stops when its stderr pipe fills or closes.
function hostFrom(stderr: ReadableStream<Uint8Array>) {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  void (async () => {
    const decoder = new TextDecoder();
    let text: string | null = "";
    for await (const chunk of stderr) {
      if (text !== null) {
        text += decoder.decode(chunk, { stream: true });
        const url = TUNNEL_URL.exec(text);
        if (url) {
          resolve(new URL(url[0]).host);
          text = null;
        }
      }
    }
  })()
    .catch(() => {})
    .finally(() => resolve(null));
  return promise;
}

// A Cloudflare quick tunnel to this server, and the guest code that goes with it. Each start makes a new code,
// so a link from an earlier share never works again.
export class Share {
  host: string | null = null;
  guestCode: string | null = null;
  private tunnel: Tunnel | null = null;
  private starting: Promise<{ link: string } | { error: string }> | null = null;

  constructor(
    private readonly opts: {
      port: () => number;
      spawn?: Spawn;
      allowedMail?: string[];
      people: People;
      onChange: () => void;
      runner?: Runner;
      timeoutMs?: number;
      which?: (cmd: string) => string | null;
    },
  ) {}

  // What to install before a tunnel can start, or null when cloudflared is on the PATH.
  get missing() {
    const which = this.opts.which ?? (cmd => Bun.which(cmd));
    return which("cloudflared") ? null : `sharing needs cloudflared, which is free and needs no Cloudflare account: ${INSTALL}`;
  }

  get link() {
    return this.host && this.guestCode ? `https://${this.host}/?g=${this.guestCode}` : null;
  }

  start(): Promise<{ link: string } | { error: string }> {
    if (this.link) {
      return Promise.resolve({ link: this.link });
    }
    this.starting ??= this.open().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  stop() {
    const tunnel = this.tunnel;
    if (!tunnel) {
      return;
    }
    this.tunnel = null;
    this.host = null;
    this.guestCode = null;
    tunnel.kill();
    // However the share ends, its guests go with it: a new share's host never gets the old cookies anyway.
    this.opts.people.revokeAll();
    this.opts.onChange();
  }

  private async open(): Promise<{ link: string } | { error: string }> {
    const mail = this.opts.allowedMail ?? [];
    if (mail.length > 0) {
      const tooOld = await this.tooOld();
      if (tooOld) {
        return { error: tooOld };
      }
    }
    const cmd = ["cloudflared", "tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${this.opts.port()}`];
    if (mail.length > 0) {
      cmd.push("--allowed-mail", mail.join(","));
    }
    let tunnel: Tunnel;
    try {
      tunnel = (this.opts.spawn ?? spawnTunnel)(cmd);
    } catch (error) {
      return { error: `cloudflared didn't start (${error instanceof Error ? error.message : String(error)}): ${INSTALL}` };
    }
    this.tunnel = tunnel;

    const ms = this.opts.timeoutMs ?? 30_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), ms);
    });
    const host = await Promise.race([hostFrom(tunnel.stderr), timeout]).finally(() => clearTimeout(timer));
    if (this.tunnel !== tunnel) {
      return { error: "sharing was stopped before the tunnel was up" };
    }
    if (!host) {
      this.tunnel = null;
      tunnel.kill();
      return { error: `cloudflared gave no tunnel address within ${ms / 1000} seconds: check this machine can reach Cloudflare` };
    }

    this.host = host;
    this.guestCode = randomBytes(24).toString("hex");
    void tunnel.exited.then(() => {
      if (this.tunnel === tunnel) {
        this.stop();
      }
    });
    this.opts.onChange();
    return { link: `https://${host}/?g=${this.guestCode}` };
  }

  // The reason the email gate can't be used, or null when this cloudflared has --allowed-mail.
  private async tooOld() {
    const said = await (this.opts.runner ?? run)(["cloudflared", "--version"], process.cwd()).catch(() => null);
    if (said?.code !== 0) {
      return `PRG_ALLOWED_MAIL needs cloudflared, which isn't here: ${INSTALL}`;
    }
    const [, year, month] = /version (\d+)\.(\d+)/.exec(said.stdout) ?? [];
    if (Number(year) * 100 + Number(month) >= 202611) {
      return null;
    }
    return `PRG_ALLOWED_MAIL needs cloudflared 2026.11 or later for --allowed-mail, and this one says "${said.stdout.trim()}": update it (brew upgrade cloudflared, or https://github.com/cloudflare/cloudflared/releases)`;
  }
}
