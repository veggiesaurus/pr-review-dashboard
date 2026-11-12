import type { Layer } from "../shared/payload";
import type { Loaded } from "./load";

// The review the server holds, and how to load it again from disk.
export class Review {
  private loaded: Loaded;
  private pending: Promise<{ ok: true } | { ok: false; error: string }> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    initial: Loaded,
    private readonly load: () => Promise<Loaded>,
  ) {
    this.loaded = initial;
  }

  get response() {
    return this.loaded.response;
  }

  get stacked() {
    return this.loaded.response.stack !== null;
  }

  layer(id: number): Layer | undefined {
    return this.loaded.response.layers.find(layer => layer.id === id);
  }

  // The whole new file, for the lines the page asks for.
  text(layer: number, file: string): string[] | undefined {
    return this.loaded.texts.get(`${layer}:${file}`);
  }

  // Every issue any layer names: the Linear lookups are limited to these.
  issueKeys(): string[] {
    return [...new Set(this.loaded.response.layers.flatMap(layer => layer.issueKeys))];
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // A failed load keeps what is there. Two reloads at once share one load.
  reload() {
    this.pending ??= this.load()
      .then(next => {
        this.loaded = next;
        for (const listener of this.listeners) {
          listener();
        }
        return { ok: true as const };
      })
      .catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }))
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
}
