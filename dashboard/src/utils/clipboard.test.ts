import { afterEach, describe, expect, test } from "bun:test";

import { copyToClipboard } from "src/utils/clipboard";

const page = globalThis as unknown as Record<string, unknown>;
const real = { navigator: page.navigator, document: page.document };

// Just enough of a page to copy through a text box, recording what was selected when the copy ran.
function fakePage(clipboard: { writeText: (text: string) => Promise<void> } | undefined, allowed = true) {
  const copied: string[] = [];
  const box = { value: "", style: {}, setAttribute() {}, select() {}, remove() {} };
  Object.assign(globalThis, {
    navigator: clipboard ? { clipboard } : {},
    document: {
      createElement: () => box,
      body: { append() {} },
      execCommand: () => {
        copied.push(box.value);
        return allowed;
      },
    },
  });
  return copied;
}

afterEach(() => {
  Object.assign(globalThis, real);
});

describe("copyToClipboard", () => {
  test("over plain http, where the page has no clipboard, it copies through a text box", async () => {
    const copied = fakePage(undefined);
    await copyToClipboard("the summary");
    expect(copied).toEqual(["the summary"]);
  });

  test("when the browser refuses the clipboard it falls back to the text box too", async () => {
    const copied = fakePage({ writeText: () => Promise.reject(new Error("denied")) });
    await copyToClipboard("the summary");
    expect(copied).toEqual(["the summary"]);
  });

  test("it rejects when the text box can't copy either, so the button can say so", async () => {
    fakePage(undefined, false);
    await expect(copyToClipboard("the summary")).rejects.toThrow();
  });
});
