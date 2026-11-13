import { Extension } from "@tiptap/core";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";

import { cn } from "src/utils/cn";

// How the boxes send: the chat boxes on Enter, the note composer on ⌘↵ (a note) and ⇧⌘↵ (a question now).
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
};

const CONTENT = cn(
  "min-h-8 max-h-60 overflow-y-auto px-2.5 py-1.5 text-sm leading-normal outline-none [overflow-wrap:anywhere]",
  "[&>*+*]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.875em]",
  "[&_pre]:whitespace-pre-wrap [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-muted/60 [&_pre]:p-2.5 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[1em]",
  "[&_a]:text-primary [&_a]:underline [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold",
  "[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
);

// A box that formats markdown as it is typed (`code`, _emphasis_, fenced blocks, lists) and hands back markdown,
// so drafts, edits and what reaches the session stay plain text.
export function MarkdownEditor({ value, onChange, onSend, onEscape, onFiles, sendKey, label, placeholder, autoFocus, className }: Props) {
  // The editor is made once; the latest handlers are read through this.
  const latest = useRef({ onChange, onSend, onEscape, onFiles, sendKey });
  latest.current = { onChange, onSend, onEscape, onFiles, sendKey };

  const take = (files: FileList | undefined) => Boolean(files?.length && latest.current.onFiles?.(files));

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, protocols: [] } }),
      Markdown,
      Placeholder.configure({ placeholder }),
      CharacterCount.configure({ limit: 4000 }),
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
            ["Shift-Enter", () => fence() || newLine()],
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
