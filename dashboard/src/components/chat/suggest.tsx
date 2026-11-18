import type { EditorState } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import type { ReactNode } from "react";

import { cn } from "src/utils/cn";

type ListProps<T> = { id: string; label: string; items: T[]; active: number; row: (item: T) => ReactNode; pick: (item: T) => void };

export function SuggestList<T>({ id, label, items, active, row, pick }: ListProps<T>) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div
      id={id}
      role="listbox"
      aria-label={label}
      className="grid min-w-48 max-w-80 gap-0.5 rounded-lg border bg-popover p-1 font-sans text-popover-foreground text-sm shadow-md"
    >
      {items.map((item, i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is redrawn whole on each keystroke
          key={i}
          id={`${id}-${i}`}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={i === active}
          // Keeps the editor's focus and selection, which the pick inserts at.
          onMouseDown={event => {
            event.preventDefault();
            pick(item);
          }}
          className={cn(
            "flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left",
            i === active && "bg-accent text-accent-foreground",
          )}
        >
          {row(item)}
        </button>
      ))}
    </div>
  );
}

let lists = 0;
const LINKS = ["aria-expanded", "aria-controls", "aria-activedescendant"];

// A suggestion opens only outside code, where what it inserts would be read as code.
export const outsideCode = ({ state, range }: { state: EditorState; range: { from: number; to: number } }) =>
  state.doc.resolve(range.from).parent.type.name !== "codeBlock" &&
  !(state.schema.marks.code && state.doc.rangeHasMark(range.from, range.to, state.schema.marks.code));

// A suggestion's items under the cursor: arrow keys move, Enter or Tab picks, Escape closes.
export function suggestRender<T>(row: (item: T) => ReactNode, label: string): SuggestionOptions<T, T>["render"] {
  return () => {
    const id = `suggest-${++lists}`;
    let list: ReactRenderer<unknown, ListProps<T>> | null = null;
    let unmount = () => {};
    let current: SuggestionProps<T, T> | null = null;
    let active = 0;
    // The box says which list it drives and which option is current, while there is one to show.
    const link = () => {
      const box = current?.editor.view.dom;
      if (box && current?.items.length) {
        box.setAttribute("aria-expanded", "true");
        box.setAttribute("aria-controls", id);
        box.setAttribute("aria-activedescendant", `${id}-${active}`);
      } else {
        for (const name of LINKS) {
          box?.removeAttribute(name);
        }
      }
    };
    const show = () => {
      if (current) {
        list?.updateProps({ items: current.items, active, pick: current.command });
      }
      link();
    };
    return {
      onStart: props => {
        current = props;
        active = 0;
        list = new ReactRenderer(SuggestList<T>, {
          editor: props.editor,
          props: { id, label, items: props.items, active, row, pick: props.command },
          className: "z-50",
        });
        unmount = props.mount(list.element);
        link();
      },
      onUpdate: props => {
        current = props;
        active = 0;
        show();
      },
      onKeyDown: ({ event }) => {
        const items = current?.items ?? [];
        if (event.key === "Escape") {
          // The plugin closes the list; this keeps the drawer around the box open.
          event.stopPropagation();
          return true;
        }
        if (items.length === 0) {
          return false;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          active = (active + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
          show();
          return true;
        }
        const item = items[active];
        if ((event.key === "Enter" || event.key === "Tab") && item !== undefined) {
          current?.command(item);
          return true;
        }
        return false;
      },
      onExit: props => {
        for (const name of LINKS) {
          props.editor.view.dom.removeAttribute(name);
        }
        unmount();
        list?.destroy();
        list = null;
        current = null;
      },
    };
  };
}
