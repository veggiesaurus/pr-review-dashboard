import type { Element, ElementContent, Root, RootContent } from "hast";
import { ImageIcon } from "lucide-react";
import type { RootContent as MdContent, Nodes as MdNodes, Root as MdRoot, Paragraph, PhrasingContent } from "mdast";
import { Fragment, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { shortRef, splitRefs, urlRef } from "shared/refs";

import { CodeText } from "src/components/diff/CodeText";
import { useHighlighter } from "src/components/diff/hooks";
import { LINK } from "src/components/links/Prose";
import { RefLink } from "src/components/links/RefLink";
import { useLayer } from "src/queries/review.query";
import { useViewStore } from "src/store/view.store";
import { cn } from "src/utils/cn";

const ANCHOR = /^(\d+:)?f\d+(h\d+)?$/;
const LEAVE = new Set(["a", "code", "pre"]);
const text = (value: string): ElementContent => ({ type: "text", value });

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const BLOCK_TAG = /^(?:p|div|li|ul|ol|dl|dt|dd|summary|details|blockquote|table|tr|pre|hr|h[1-6])$/;
const TAG = /^<(\/?)([a-z][a-z0-9-]*)\b[^>]*>$/i;
const BLOCK_PARENTS = new Set(["root", "blockquote", "listItem", "footnoteDefinition"]);

const decode = (value: string) =>
  value.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/gi, (entity, dec?: string, hex?: string, name?: string) => {
    const code = dec ? Number(dec) : hex ? Number.parseInt(hex, 16) : null;
    return code !== null
      ? code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : entity
      : (ENTITIES[name?.toLowerCase() ?? ""] ?? entity);
  });

// A block of HTML as tags and the text between them, its whitespace collapsed as a browser would.
const tokens = (value: string): PhrasingContent[] =>
  value
    .split(/(<!--[\s\S]*?(?:-->|$)|<\/?[a-z][^>]*>|<![^>]*>)/i)
    .flatMap((piece, i): PhrasingContent[] =>
      i % 2 ? [{ type: "html", value: piece }] : piece ? [{ type: "text", value: decode(piece.replace(/\s+/g, " ")) }] : [],
    );

// A picture written as HTML, as GitHub's editor writes a pasted screenshot, kept the way a markdown one is.
function htmlImage(tag: string): PhrasingContent | null {
  const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
  const alt = /\salt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
  return src ? { type: "image", url: decode(src), alt: decode(alt ?? "") } : null;
}

const blank = (node: PhrasingContent | undefined) => node?.type === "break" || (node?.type === "text" && !node.value.trim());

// HTML as the text it stands for: tags go and their text stays, a block tag starts a paragraph (a line, among the
// words of one) and <br> a line, an <img> stays as a picture, and comments, scripts and styles go with their text.
function htmlText(nodes: PhrasingContent[], block: boolean): PhrasingContent[][] {
  const paragraphs: PhrasingContent[][] = [[]];
  let skipping: string | null = null;
  for (const node of nodes) {
    const current = paragraphs.at(-1) as PhrasingContent[];
    const tag = node.type === "html" ? TAG.exec(node.value.trim()) : null;
    const name = tag?.[2]?.toLowerCase() ?? "";
    if (skipping) {
      skipping = tag?.[1] && name === skipping ? null : skipping;
    } else if (node.type !== "html") {
      if (!(blank(node) && (current.length === 0 || blank(current.at(-1))))) {
        current.push(node);
      }
    } else if (!tag) {
      // A comment or a declaration.
    } else if (!tag[1] && (name === "script" || name === "style")) {
      skipping = name;
    } else if (name === "img") {
      const image = htmlImage(node.value);
      if (image) {
        current.push(image);
      }
    } else if (name === "br" || (!block && BLOCK_TAG.test(name))) {
      while (blank(current.at(-1))) {
        current.pop();
      }
      if (current.length > 0) {
        current.push({ type: "break" });
      }
    } else if (BLOCK_TAG.test(name) && current.length > 0) {
      paragraphs.push([]);
    }
  }
  for (const paragraph of paragraphs) {
    while (blank(paragraph.at(-1))) {
      paragraph.pop();
    }
  }
  return paragraphs.filter(paragraph => paragraph.length > 0);
}

// Raw HTML in a description is never drawn as HTML; this puts the text and breaks it stands for in its place.
function remarkHtmlText() {
  const visit = (node: MdNodes): void => {
    if (!("children" in node)) {
      return;
    }
    if (node.children.some(child => child.type === "html")) {
      if (BLOCK_PARENTS.has(node.type)) {
        (node as MdRoot).children = (node.children as MdContent[]).flatMap(child =>
          child.type === "html"
            ? htmlText(tokens(child.value), true).map((children): Paragraph => ({ type: "paragraph", children }))
            : [child],
        );
      } else {
        (node as Paragraph).children = htmlText(node.children as PhrasingContent[], false)[0] ?? [];
      }
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  return (tree: MdRoot) => visit(tree);
}

// References in the text become spans the components below turn into previews; a picture becomes a link to it, since
// the page loads nothing from another host, or its alt text inside a link.
function rehypeRefs({ repo }: { repo: string | null }) {
  const visit = (node: Root | Element, inLink: boolean): void => {
    node.children = node.children.flatMap((child: RootContent): RootContent[] => {
      if (child.type === "element" && child.tagName === "img") {
        const src = String(child.properties.src ?? "");
        const alt = String(child.properties.alt ?? "") || "image";
        if (inLink || !src.startsWith("https://")) {
          return [text(alt)];
        }
        return [{ type: "element", tagName: "a", properties: { href: src, dataImage: "1" }, children: [text(alt)] }];
      }
      if (child.type === "element") {
        if (child.tagName !== "code" && child.tagName !== "pre") {
          visit(child, inLink || child.tagName === "a");
        }
        return [child];
      }
      if (child.type !== "text" || inLink || ("tagName" in node && LEAVE.has(node.tagName))) {
        return [child];
      }
      return splitRefs(child.value, repo).map(part =>
        part.type === "ref"
          ? { type: "element", tagName: "span", properties: { dataRef: JSON.stringify(part.ref) }, children: [text(part.text)] }
          : text(part.type === "text" ? part.text : ""),
      );
    }) as typeof node.children;
  };
  return (tree: Root) => visit(tree, false);
}

// A PR or issue description: GitHub's markdown, with raw HTML reduced to its text, links only to https, pictures as links, and the
// same references as Prose unfurled inside it.
export function Markdown({ source, layer, className }: { source: string; layer: number; className?: string }) {
  const repo = useLayer(layer)?.meta.repo || null;
  const goTo = useViewStore(state => state.goTo);

  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, ...props }) => {
        if (href && ANCHOR.test(href)) {
          return (
            <a
              href={`#${href}`}
              className={LINK}
              onClick={event => {
                event.preventDefault();
                goTo(layer, href);
              }}
            >
              {children}
            </a>
          );
        }
        if (!href?.startsWith("https://")) {
          return <span>{children}</span>;
        }
        const ref = urlRef(href);
        const image = "data-image" in props;
        return (
          <RefLink
            reference={ref}
            text={
              image ? (
                <>
                  <ImageIcon className="mr-1 inline size-3.5 align-[-0.125em]" />
                  {children}
                </>
              ) : ref && children === href ? (
                shortRef(ref, repo)
              ) : (
                children
              )
            }
            href={href}
            repo={repo}
            className={LINK}
          />
        );
      },
      span: ({ children, node: _node, ...props }) => {
        const raw = (props as Record<string, unknown>)["data-ref"];
        return typeof raw === "string" ? (
          <RefLink reference={JSON.parse(raw)} text={children} href={null} repo={repo} />
        ) : (
          <span>{children}</span>
        );
      },
      input: ({ type, checked }) =>
        type === "checkbox" ? (
          <input type="checkbox" checked={Boolean(checked)} readOnly disabled className="mr-1.5 size-3.5 align-[-0.125em] accent-primary" />
        ) : null,
      h1: ({ children }) => <h3 className="mt-5 font-semibold text-xl">{children}</h3>,
      h2: ({ children }) => <h3 className="mt-5 font-semibold text-lg">{children}</h3>,
      h3: ({ children }) => <h4 className="mt-4 font-semibold text-base">{children}</h4>,
      h4: ({ children }) => <h5 className="mt-4 font-semibold text-[15px]">{children}</h5>,
      h5: ({ children }) => <h6 className="mt-4 font-semibold text-sm">{children}</h6>,
      h6: ({ children }) => <h6 className="mt-4 font-semibold text-muted-foreground text-sm">{children}</h6>,
      ul: ({ children }) => <ul className="grid list-disc gap-1 pl-6">{children}</ul>,
      ol: ({ children, start }) => (
        <ol start={start} className="grid list-decimal gap-1 pl-6">
          {children}
        </ol>
      ),
      li: ({ children, className }) => (
        <li className={className === "task-list-item" ? "-ml-5 list-none [&>ul]:mt-1" : "pl-0.5 [&>ol]:mt-1 [&>ul]:mt-1"}>{children}</li>
      ),
      blockquote: ({ children }) => <blockquote className="grid gap-2 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
      code: ({ children, className }) => {
        const language = /\blanguage-([\w+#-]+)/.exec(className ?? "")?.[1]?.toLowerCase();
        return (
          <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.875em]">
            {language && typeof children === "string" ? <Highlighted text={children} language={language} /> : children}
          </code>
        );
      },
      pre: ({ children }) => (
        <pre className="whitespace-pre-wrap rounded-md border bg-muted/60 p-3 font-mono text-[13px] leading-normal [overflow-wrap:anywhere] [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[1em]">
          {children}
        </pre>
      ),
      table: ({ children }) => (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      ),
      th: ({ children, style }) => (
        <th style={style} className="whitespace-nowrap border-b bg-muted/60 px-3 py-1.5 text-left font-medium">
          {children}
        </th>
      ),
      td: ({ children, style }) => (
        <td style={style} className="border-b px-3 py-1.5 align-top [overflow-wrap:break-word] [tr:last-child>&]:border-b-0">
          {children}
        </td>
      ),
      hr: () => <hr className="border-t" />,
    }),
    [goTo, layer, repo],
  );

  return (
    <div className={cn("text-[15px] leading-relaxed [overflow-wrap:anywhere] [&>*+*]:mt-3", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkHtmlText]} rehypePlugins={[[rehypeRefs, { repo }]]} skipHtml components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}

// A fenced block's code coloured as the diff colours code, once highlight.js has loaded; plain until then, or for a
// language it doesn't know.
function Highlighted({ text, language }: { text: string; language: string }) {
  const highlighter = useHighlighter();
  const lines = useMemo(() => text.replace(/\n$/, "").split("\n"), [text]);
  const segments = useMemo(() => highlighter?.highlightLines(lines, language), [highlighter, lines, language]);
  return lines.map((line, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: a block's lines never reorder
    <Fragment key={i}>
      {i > 0 && "\n"}
      <CodeText text={line} segments={segments?.[i]} />
    </Fragment>
  ));
}

// A message typed in a chat box: markdown at the size of the thread, with a line break kept where it was typed.
export function MessageText({ text, layer, className }: { text: string; layer: number; className?: string }) {
  return (
    <Markdown source={text} layer={layer} className={cn("text-sm leading-normal [&>*+*]:mt-2 [&_p]:whitespace-pre-wrap", className)} />
  );
}
