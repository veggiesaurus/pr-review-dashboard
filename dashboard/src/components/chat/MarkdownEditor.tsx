import { Extension, InputRule } from "@tiptap/core";
import type { EmojiItem } from "@tiptap/extension-emoji";
import Mention from "@tiptap/extension-mention";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { PluginKey } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Suggestion } from "@tiptap/suggestion";
import { useEffect, useRef } from "react";
import type { Person, Skill } from "shared/messages";

import { emojiNow, loadEmoji, matchEmoji } from "src/components/chat/emoji";
import { outsideCode, suggestRender } from "src/components/chat/suggest";
import { PersonFace } from "src/components/links/Github";
import { useMe } from "src/queries/me.query";
import { usePeople } from "src/queries/people.query";
import { useSkills } from "src/queries/skills.query";
import { cn } from "src/utils/cn";

// How the boxes send: the chat boxes on Enter, the note composer on ⌘↵ (a note) and ⇧↵ or ⇧⌘↵ (a question now).
export type SendKey = "enter" | "mod-enter";

type Props = {
  value: string;
  onChange: (markdown: string) => void;
  onSend: (shift: boolean) => void;
  onEscape?: () => void;
  // Image files dropped or pasted in; the editor keeps text and leaves pictures to the box around it.
  onFiles?: (files: FileList) => boolean;
  sendKey: SendKey;
  label: string;
  placeholder: string;
  autoFocus?: boolean;
  className?: string;
  // Off where what is typed doesn't reach Claude, as in a post between people.
  skills?: boolean;
};

const CONTENT = cn(
  "min-h-8 max-h-60 overflow-y-auto px-2.5 py-1.5 text-sm leading-normal outline-none [overflow-wrap:anywhere]",
  "[&>*+*]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.875em]",
  "[&_pre]:whitespace-pre-wrap [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-muted/60 [&_pre]:p-2.5 [&_pre]:font-mono [&_pre]:text-sm [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[1em]",
  "[&_a]:text-primary [&_a]:underline [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold",
  "[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
);

type Mentionable = { id: string; label: string; person: Person };

// Written as the plain @handle the server looks for, and above the send keys so Enter picks from the list.
const PlainMention = Mention.extend({
  priority: 1001,
  renderMarkdown: node => `@${node.attrs?.label ?? ""}`,
});

const mentionRow = ({ label, person }: Mentionable) => (
  <>
    <PersonFace person={person} />
    <span className="truncate">{label}</span>
    {person.login && person.name && <span className="truncate text-muted-foreground text-xs">{person.name}</span>}
  </>
);

const emojiRow = (e: EmojiItem) => (
  <>
    <span>{e.emoji}</span>
    <span className="truncate text-muted-foreground text-xs">:{e.shortcodes[0]}:</span>
  </>
);

const skillRow = ({ name, description }: Skill) => (
  <span className="grid min-w-0">
    <span className="truncate font-mono text-[12.5px]">/{name}</span>
    {description && <span className="truncate text-muted-foreground text-xs">{description}</span>}
  </span>
);

// Names that start with what was typed come first, then names holding it, then descriptions that mention it. Among
// equals the shorter name after any plugin: wins, so pr-review comes before receiving-code-review, and a built-in
// code-review before code-review:code-review.
export function matchSkills(skills: Skill[], query: string) {
  const q = query.toLowerCase();
  const short = (name: string) => name.slice(name.indexOf(":") + 1);
  const rank = ({ name, description }: Skill) => {
    const bare = name.toLowerCase();
    return bare.startsWith(q) || short(bare).startsWith(q) ? 0 : bare.includes(q) ? 1 : description?.toLowerCase().includes(q) ? 2 : 3;
  };
  return skills
    .map(skill => ({ skill, rank: rank(skill) }))
    .filter(({ rank }) => rank < 3)
    .sort((a, b) => a.rank - b.rank || short(a.skill.name).length - short(b.skill.name).length || a.skill.name.length - b.skill.name.length)
    .slice(0, 8)
    .map(({ skill }) => skill);
}

// :think offers emoji and the pick is stored as the character itself; :name: typed through converts.
const EmojiPicker = Extension.create({
  name: "emojiPicker",
  priority: 1001,
  addProseMirrorPlugins() {
    return [
      Suggestion<EmojiItem, EmojiItem>({
        editor: this.editor,
        pluginKey: new PluginKey("emojiSuggestion"),
        char: ":",
        allow: outsideCode,
        items: async ({ query }) => matchEmoji(await loadEmoji(), query),
        command: ({ editor, range, props }) =>
          editor
            .chain()
            .focus()
            .insertContentAt(range, props.emoji ?? "")
            .run(),
        render: suggestRender(emojiRow, "Emoji"),
      }),
    ];
  },
  addInputRules() {
    return [
      new InputRule({
        find: /:([a-z0-9_+-]+):$/,
        handler: ({ state, range, match }) => {
          const emoji = emojiNow()?.find(e => e.shortcodes.includes(match[1] ?? ""))?.emoji;
          if (emoji) {
            state.tr.insertText(emoji, range.from, range.to);
          }
        },
      }),
    ];
  },
});

// A box that formats markdown as it is typed (`code`, _emphasis_, fenced blocks, lists) and hands back markdown,
// so drafts, edits and what reaches the session stay plain text.
export function MarkdownEditor({
  value,
  onChange,
  onSend,
  onEscape,
  onFiles,
  sendKey,
  label,
  placeholder,
  autoFocus,
  className,
  skills: offerSkills = true,
}: Props) {
  // The editor is made once; the latest handlers are read through this.
  const me = useMe()?.person?.id;
  const people = usePeople().filter(p => p.id !== me);
  const known = useSkills();
  const skills = offerSkills ? known : [];
  const latest = useRef({ onChange, onSend, onEscape, onFiles, sendKey, people, skills });
  latest.current = { onChange, onSend, onEscape, onFiles, sendKey, people, skills };

  const take = (files: FileList | undefined) => Boolean(files?.length && latest.current.onFiles?.(files));

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, protocols: [] } }),
      Markdown,
      Placeholder.configure({ placeholder }),
      CharacterCount.configure({ limit: 4000 }),
      PlainMention.configure({
        HTMLAttributes: { class: "rounded-sm bg-primary/10 px-0.5 text-primary" },
        suggestion: {
          char: "@",
          allow: outsideCode,
          items: ({ query }): Mentionable[] =>
            latest.current.people
              .map(person => ({ id: String(person.id), label: person.login || person.name || "", person }))
              .filter(item => item.label !== "" && item.label.toLowerCase().startsWith(query.toLowerCase()))
              .slice(0, 8),
          render: suggestRender(mentionRow, "People"),
        },
      }),
      EmojiPicker,
      // /rev offers the skills the session can run, written into the message as /code-review for the session to run.
      Extension.create({
        name: "skillPicker",
        priority: 1001,
        addProseMirrorPlugins() {
          return [
            Suggestion<Skill, Skill>({
              editor: this.editor,
              pluginKey: new PluginKey("skillSuggestion"),
              char: "/",
              allow: outsideCode,
              items: ({ query }) => matchSkills(latest.current.skills, query),
              command: ({ editor, range, props }) => editor.chain().focus().insertContentAt(range, `/${props.name} `).run(),
              render: suggestRender(skillRow, "Skills"),
            }),
          ];
        },
      }),
      Extension.create({
        name: "sendKeys",
        priority: 1000,
        addKeyboardShortcuts() {
          // What Enter does in a box that doesn't send on it: a new line in code, a new item in a list, else a new paragraph.
          const newLine = () =>
            this.editor.commands.first(({ commands }) => [
              () => commands.newlineInCode(),
              () => commands.splitListItem("listItem"),
              () => commands.createParagraphNear(),
              () => commands.liftEmptyBlock(),
              () => commands.splitBlock(),
            ]);
          const send = (shift: boolean) => {
            latest.current.onSend(shift);
            return true;
          };
          const inCode = () => this.editor.isActive("codeBlock");
          // A line that is only a fence and a language starts a code block on Enter, as it does on a space.
          const fence = () => {
            const { $from, empty } = this.editor.state.selection;
            const opened = empty && $from.parent.type.name === "paragraph" ? /^```([\w+#-]*)$/.exec($from.parent.textContent) : null;
            if (!opened) {
              return false;
            }
            return this.editor
              .chain()
              .command(({ tr }) => {
                tr.delete($from.start(), $from.end());
                return true;
              })
              .setCodeBlock(opened[1] ? { language: opened[1] } : undefined)
              .run();
          };
          return Object.fromEntries([
            ["Enter", () => fence() || (latest.current.sendKey === "enter" && !inCode() ? send(false) : false)],
            ["Shift-Enter", () => fence() || (latest.current.sendKey === "mod-enter" ? send(true) : newLine())],
            ["Mod-Enter", () => send(false)],
            ["Shift-Mod-Enter", () => send(true)],
            [
              "Escape",
              () => {
                latest.current.onEscape?.();
                // Not marked handled, so the drawer around the box still closes on it as it did.
                return false;
              },
            ],
          ]);
        },
      }),
    ],
    content: value,
    contentType: "markdown",
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: { class: CONTENT, role: "textbox", "aria-multiline": "true", "aria-label": label },
      handlePaste: (_view, event) => take(event.clipboardData?.files),
      handleDrop: (_view, event) => take((event as DragEvent).dataTransfer?.files),
    },
    onUpdate: ({ editor }) => latest.current.onChange(editor.isEmpty ? "" : editor.getMarkdown()),
  });

  // Text set from outside (cleared after a send, a draft put back) replaces what is shown.
  useEffect(() => {
    if (editor && value !== (editor.isEmpty ? "" : editor.getMarkdown())) {
      editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
    }
  }, [editor, value]);

  return (
    <EditorContent
      editor={editor}
      className={cn(
        "min-w-0 rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring/40 focus-within:ring-inset",
        className,
      )}
    />
  );
}
