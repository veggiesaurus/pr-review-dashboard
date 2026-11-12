import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { bruStep, type Segment, splitHighlighted } from "src/utils/diff";

// Loaded on demand by the diff, so the first paint doesn't wait for the grammars.
const LANGUAGES = {
  bash,
  csharp,
  css,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  makefile,
  markdown,
  php,
  python,
  ruby,
  rust,
  scss,
  sql,
  typescript,
  xml,
  yaml,
};
for (const [name, language] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, language);
}

hljs.registerLanguage("bru", () => ({
  name: "Bru",
  contains: [
    { scope: "title", match: /^[a-z][\w:-]*(?=\s*\{\s*$)/ },
    { scope: "comment", match: /^[ \t]*~.*$/ },
    { scope: "attr", match: /^[ \t]*[^\s:{}~][^:{}\n]*?(?=:)/ },
    { scope: "template-variable", match: /\{\{[^}\n]*\}\}/ },
    { scope: "literal", match: /\b(true|false|null)\b/ },
    { scope: "number", match: /\b\d+(\.\d+)?\b/ },
  ],
}));

const plain = (texts: string[]): Segment[][] => texts.map(text => [{ text, classes: [] }]);

// A run of lines highlighted as one text, so block comments and template strings carry across lines.
function highlightRun(texts: string[], language: string | null): Segment[][] {
  if (!language || !hljs.getLanguage(language)) {
    return plain(texts);
  }
  try {
    const lines = splitHighlighted(hljs.highlight(texts.join("\n"), { language, ignoreIllegals: true }).value);
    return lines.length === texts.length ? lines : plain(texts);
  } catch {
    return plain(texts);
  }
}

// Consecutive lines of one file. A .bru file's lines start in `block` and each run is highlighted in the language
// of the block it sits in.
export function highlightLines(texts: string[], language: string | null, block: string | null = null): Segment[][] {
  if (language !== "bru") {
    return highlightRun(texts, language);
  }
  let at = block;
  const languages = texts.map(text => {
    const [lang, next] = bruStep(at, text);
    at = next;
    return lang;
  });
  const out: Segment[][] = [];
  for (let k = 0; k < texts.length; ) {
    let end = k;
    while (end < texts.length && languages[end] === languages[k]) {
      end++;
    }
    out.push(...highlightRun(texts.slice(k, end), languages[k] ?? null));
    k = end;
  }
  return out;
}
