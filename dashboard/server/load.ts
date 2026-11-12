import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { z } from "zod";

import {
  type BruBlock,
  type Layer,
  type RawLayer,
  type ReviewResponse,
  rawLayerSchema,
  rawStackSchema,
  type StackInfo,
} from "../shared/payload";
import { type RunResult, run } from "./exec";
import { issueKeys } from "./linear";

// texts holds each file's whole new text, keyed "<layer>:<file>", which stays on the server.
export type Loaded = { response: Omit<ReviewResponse, "linear">; texts: Map<string, string[]> };

const DATA = /<script id="prg-data" type="application\/json">([\s\S]*?)<\/script>/;
const BRU_OPEN = /^([a-z][\w:-]*)\s*\{\s*$/;
const BRU_CLOSE = /^\}\s*$/;

const describe = (error: unknown) =>
  error instanceof z.ZodError ? z.prettifyError(error) : error instanceof Error ? error.message : String(error);

// render.py writes the payload into its page; the blob has every "<" escaped, so it can't end the script early.
export function extractPayload(page: string): unknown {
  const match = DATA.exec(page);
  if (!match?.[1]) {
    throw new Error("render.py's page has no prg-data block");
  }
  return JSON.parse(match[1]);
}

// The same walk as the template's bruStep, done once here so the page needn't have the file.
export function bruBlocks(lines: string[]): BruBlock[] {
  const blocks: BruBlock[] = [];
  let open: BruBlock | null = null;
  lines.forEach((text, i) => {
    if (!open) {
      const name = BRU_OPEN.exec(text)?.[1];
      if (name) {
        open = { name, open: i + 1, close: lines.length };
        blocks.push(open);
      }
    } else if (BRU_CLOSE.test(text)) {
      open.close = i + 1;
      open = null;
    }
  });
  return blocks;
}

function toLayer(raw: RawLayer, texts: Map<string, string[]>): Layer {
  const id = raw.meta.number ?? 0;
  const files = raw.files.map(file => {
    const { newText, ...kept } = file;
    if (newText) {
      texts.set(`${id}:${file.id}`, newText);
    }
    return {
      ...kept,
      lineCount: newText ? newText.length - (newText.at(-1) === "" ? 1 : 0) : null,
      ...(newText && file.path.endsWith(".bru") ? { bruBlocks: bruBlocks(newText) } : {}),
    };
  });
  const layer: Record<string, unknown> = {
    ...raw,
    id,
    issueKeys: issueKeys(raw.meta),
    capabilities: { github: id > 0, usages: Boolean(raw.meta.headSha) },
    files,
    split: raw.split ?? null,
    descriptionCheck: raw.descriptionCheck ?? null,
  };
  delete layer._split;
  return layer as Layer;
}

// One PR's payload, or render.py's stack payload {stack, layers}, as one shape: a single PR is a stack of one layer.
export function toLoaded(raw: unknown, renderError: string | null): Loaded {
  const texts = new Map<string, string[]>();
  const stacked = typeof raw === "object" && raw !== null && "stack" in raw && "layers" in raw;
  const items = stacked ? z.array(z.unknown()).min(1).parse(raw.layers) : [raw];
  const layers = items.map(item => toLayer(rawLayerSchema.parse(item), texts));
  if (new Set(layers.map(layer => layer.id)).size !== layers.length) {
    throw new Error("two layers have the same PR number");
  }
  const stack = stacked ? (rawStackSchema.parse(raw.stack) as StackInfo) : null;
  return { response: { stack, layers, renderError }, texts };
}

// What the page can still show without render.py: the diff, with no sections.
async function fromDisk(dir: string): Promise<unknown> {
  const stackFile = Bun.file(join(dir, "stack.json"));
  if (!(await stackFile.exists())) {
    return Bun.file(join(dir, "hunks.json")).json();
  }
  const stack = rawStackSchema.parse(await stackFile.json());
  const layers = await Promise.all(
    stack.layers.map(row => {
      if (basename(row.dir) !== row.dir || row.dir === "..") {
        throw new Error(`stack.json names a layer folder outside the stack: ${row.dir}`);
      }
      return Bun.file(join(dir, row.dir, "hunks.json")).json();
    }),
  );
  return { stack: { ...stack, check: null }, layers };
}

// render.py stays the one place that builds sections, moves, flags and the rest; this runs it and reads its page.
export async function loadReview(dataDir: string, scriptsDir: string): Promise<Loaded> {
  const tmp = mkdtempSync(join(tmpdir(), "prg-render-"));
  try {
    const out = join(tmp, "page.html");
    let result: RunResult | null = null;
    let said = "";
    try {
      result = await run(["python3", "-I", join(scriptsDir, "render.py"), dataDir, "--out", out], dataDir, 120_000);
    } catch (error) {
      said = `render.py didn't run: ${describe(error)}`;
    }
    if (result?.code === 0) {
      return toLoaded(extractPayload(await Bun.file(out).text()), null);
    }
    if (result) {
      said = result.stderr.trim() || result.stdout.trim() || `render.py exited with code ${result.code}`;
    }
    said = said.slice(0, 4000);
    try {
      return toLoaded(await fromDisk(dataDir), said);
    } catch (error) {
      throw new Error(`${said}\n\nand the folder couldn't be read without it: ${describe(error)}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
