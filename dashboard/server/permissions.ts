import type { PermissionPrompt, PermissionState } from "../shared/messages";

const str = (value: unknown) => (typeof value === "string" ? value : null);

export function describePrompt(tool: string, input: Record<string, unknown>): Pick<PermissionPrompt, "text" | "code" | "description"> {
  const none = { code: null, description: null };
  if (tool === "Bash") {
    return { text: "Claude wants to run", code: str(input.command), description: str(input.description) };
  }
  if (tool === "Edit" || tool === "MultiEdit") {
    return { text: "Claude wants to edit", code: str(input.file_path), description: null };
  }
  if (tool === "NotebookEdit") {
    return { text: "Claude wants to edit", code: str(input.notebook_path), description: null };
  }
  if (tool === "Write") {
    return { text: "Claude wants to write", code: str(input.file_path), description: null };
  }
  if (tool === "WebFetch") {
    return { text: "Claude wants to fetch", code: str(input.url), description: null };
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  return { text: mcp ? `Claude wants to use ${mcp[2]} from ${mcp[1]}` : `Claude wants to use ${tool}`, ...none };
}

type Entry = {
  prompt: PermissionPrompt;
  tool: string;
  key: string;
  deadline: number;
  state: PermissionState;
  waiters: ((state: PermissionState) => void)[];
};

// Permission prompts the session's hook holds open while the owner may answer them on the page.
export class Permissions {
  private entries = new Map<string, Entry>();
  private now: () => number;
  private onChange: () => void;

  constructor(opts: { onChange: () => void; now?: () => number }) {
    this.onChange = opts.onChange;
    this.now = opts.now ?? Date.now;
  }

  add(tool: string, input: Record<string, unknown>, deadline: string) {
    const id = crypto.randomUUID();
    const prompt = { id, ...describePrompt(tool, input), at: new Date(this.now()).toISOString() };
    this.entries.set(id, { prompt, tool, key: JSON.stringify(input), deadline: Date.parse(deadline), state: "waiting", waiters: [] });
    this.onChange();
    return id;
  }

  list() {
    this.expire();
    return [...this.entries.values()].filter(e => e.state === "waiting").map(e => e.prompt);
  }

  answer(id: string, behavior: "allow" | "deny") {
    this.expire();
    const entry = this.entries.get(id);
    if (entry?.state !== "waiting") {
      return false;
    }
    entry.state = behavior;
    this.settle(entry);
    this.onChange();
    return true;
  }

  drop(id: string) {
    const entry = this.entries.get(id);
    if (entry) {
      this.remove(entry);
      this.onChange();
    }
  }

  clear(tool?: string, input?: Record<string, unknown>) {
    const key = input && JSON.stringify(input);
    const matching = [...this.entries.values()].filter(
      e => tool === undefined || (e.tool === tool && (key === undefined || e.key === key)),
    );
    for (const entry of matching) {
      this.remove(entry);
    }
    if (matching.length > 0) {
      this.onChange();
    }
  }

  // An answer is reported once, then forgotten; a request that is gone is "dropped".
  wait(id: string, ms: number): Promise<PermissionState> {
    this.expire();
    const entry = this.entries.get(id);
    if (!entry) {
      return Promise.resolve("dropped");
    }
    if (entry.state !== "waiting") {
      this.entries.delete(id);
      return Promise.resolve(entry.state);
    }
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        entry.waiters = entry.waiters.filter(w => w !== done);
        resolve("waiting");
      }, ms);
      const done = (state: PermissionState) => {
        clearTimeout(timer);
        resolve(state);
      };
      entry.waiters.push(done);
    });
  }

  private remove(entry: Entry) {
    entry.state = "dropped";
    this.entries.delete(entry.prompt.id);
    this.settle(entry);
  }

  // Wakes whoever waits, and forgets an answer that was handed over.
  private settle(entry: Entry) {
    if (entry.waiters.length > 0) {
      for (const wake of entry.waiters.splice(0)) {
        wake(entry.state);
      }
      this.entries.delete(entry.prompt.id);
    }
  }

  // Tells the page only when something lapsed, and what lapsed is already gone, so a second call has nothing to say.
  private expire() {
    const lapsed = [...this.entries.values()].filter(entry => entry.deadline <= this.now());
    for (const entry of lapsed) {
      this.remove(entry);
    }
    if (lapsed.length > 0) {
      this.onChange();
    }
  }
}
