import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Skill } from "../shared/messages";
import { parseJson } from "./exec";

const NAME = /^[\w.-]{1,80}$/;

// The frontmatter fields the menu needs, from a SKILL.md or a command's .md. A description may be folded over lines.
function frontmatter(path: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, "utf8").slice(0, 8000);
  } catch {
    return {};
  }
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  const fields: Record<string, string> = {};
  let key = "";
  for (const line of block.split(/\r?\n/)) {
    const field = /^([\w-]+):\s*(.*)$/.exec(line);
    if (field?.[1]) {
      key = field[1];
      fields[key] = (field[2] ?? "").replace(/^[>|][+-]?$/, "").replace(/\s+#.*$/, "");
    } else if (key && /^\s+\S/.test(line)) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
    }
  }
  for (const [k, v] of Object.entries(fields)) {
    fields[k] = v.replace(/^(["'])(.*)\1$/, "$2");
  }
  return fields;
}

// A skill the owner can ask the session for: one the model may invoke and the user may type.
function skillFrom(path: string, fallback: string, prefix: string): Skill | null {
  const fields = frontmatter(path);
  const name = fields.name && NAME.test(fields.name) ? fields.name : fallback;
  if (!NAME.test(name) || fields["disable-model-invocation"] === "true" || fields["user-invocable"] === "false") {
    return null;
  }
  const description = (fields.description ?? "").replace(/\s+/g, " ").trim();
  return {
    name: prefix + name,
    ...(description && { description: description.length > 200 ? `${description.slice(0, 199)}…` : description }),
  };
}

// One broken link in a folder mustn't hide the rest of it.
const isDir = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};
const dirs = (path: string) => {
  try {
    return readdirSync(path).filter(entry => isDir(join(path, entry)));
  } catch {
    return [];
  }
};
const files = (path: string, ext: string) => {
  try {
    return readdirSync(path).filter(entry => entry.endsWith(ext));
  } catch {
    return [];
  }
};

// A skills folder's skills, a commands folder's commands, and the extra paths a plugin's manifest names.
function inside(base: string, prefix: string, extra: { skills?: unknown; commands?: unknown } = {}): Skill[] {
  const list = (value: unknown) =>
    typeof value === "string" ? [value] : Array.isArray(value) ? value.filter(v => typeof v === "string") : [];
  const skillDirs = [...dirs(join(base, "skills")).map(d => join(base, "skills", d))];
  for (const path of list(extra.skills).map(p => resolve(base, p))) {
    skillDirs.push(...(existsSync(join(path, "SKILL.md")) ? [path] : dirs(path).map(d => join(path, d))));
  }
  const commandFiles = files(join(base, "commands"), ".md").map(f => join(base, "commands", f));
  for (const path of list(extra.commands).map(p => resolve(base, p))) {
    commandFiles.push(...(path.endsWith(".md") ? [path] : files(path, ".md").map(f => join(path, f))));
  }
  return [
    ...skillDirs.filter(dir => existsSync(join(dir, "SKILL.md"))).map(dir => skillFrom(join(dir, "SKILL.md"), basename(dir), prefix)),
    ...commandFiles.map(file => skillFrom(file, basename(file, ".md"), prefix)),
  ].filter((skill): skill is Skill => skill !== null);
}

const json = (path: string) => {
  try {
    return parseJson(readFileSync(path, "utf8")) as Record<string, unknown> | null;
  } catch {
    return null;
  }
};

// The skills Claude Code reads from disk for a session in `repo`: the user's, the repo's, and each enabled plugin's,
// a plugin's named plugin:skill. Built-in skills and those from a claude.ai account aren't on disk; the session posts those.
export function diskSkills(claudeDir: string, repo: string): Skill[] {
  const enabled: Record<string, unknown> = {};
  for (const settings of [
    join(claudeDir, "settings.json"),
    join(repo, ".claude", "settings.json"),
    join(repo, ".claude", "settings.local.json"),
  ]) {
    Object.assign(enabled, json(settings)?.enabledPlugins ?? {});
  }
  const installed = (json(join(claudeDir, "plugins", "installed_plugins.json"))?.plugins ?? {}) as Record<string, unknown>;
  const plugins = Object.entries(installed).flatMap(([key, entries]) => {
    const name = key.split("@")[0] ?? "";
    // A project or local install belongs to its own repo.
    const install = (Array.isArray(entries) ? entries : []).find(
      e => e?.installPath && (e.scope === "user" || resolve(e.projectPath ?? "") === resolve(repo)),
    );
    if (enabled[key] !== true || !install || !NAME.test(name)) {
      return [];
    }
    const manifest = json(join(install.installPath, ".claude-plugin", "plugin.json")) ?? {};
    return inside(install.installPath, `${name}:`, manifest);
  });
  return [...inside(claudeDir, ""), ...inside(join(repo, ".claude"), ""), ...plugins];
}
