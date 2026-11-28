// The few parts of the page the copy uses, typed here so the tests, which have no DOM, can compile and fake them.
type Page = {
  navigator: { clipboard?: { writeText: (text: string) => Promise<void> } };
  document: {
    createElement: (tag: "textarea") => {
      value: string;
      style: Record<string, string>;
      setAttribute: (name: string, value: string) => void;
      select: () => void;
      remove: () => void;
    };
    body: { append: (node: never) => void };
    execCommand: (command: string) => boolean;
  };
};

// Copies text, or rejects when the browser won't. A page over plain http (the --host link on a phone) has no
// navigator.clipboard, so it copies through a hidden text box instead, which browsers still allow on a click.
export async function copyToClipboard(text: string): Promise<void> {
  const { navigator, document } = globalThis as unknown as Page;
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Refused (permissions, an embedded frame): the text box below may still work.
  }
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.opacity = "0";
  document.body.append(box as never);
  box.select();
  const copied = document.execCommand("copy");
  box.remove();
  if (!copied) {
    throw new Error("the browser blocked copying");
  }
}
