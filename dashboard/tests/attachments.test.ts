import { expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";

import type { Message } from "../shared/messages";
import { addedLine, COOKIE, HOST, PORT, setup } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test("a screenshot is kept by its content, reaches the session as a path it can read, and only the page can add one", async () => {
  const { page, session, post, attachments, app } = setup();
  const upload = (who: typeof page, body: Uint8Array | string) => who("/api/attachments", { method: "POST", body });

  expect((await upload(session, PNG)).status).toBe(403);
  expect((await upload(page, "<svg onload=alert(1)>")).status).toBe(415);
  const { id } = (await (await upload(page, PNG)).json()) as { id: string };
  expect(id).toMatch(/^[0-9a-f]{64}\.png$/);
  expect(statSync(join(attachments, id)).mode & 0o777).toBe(0o600);

  // An <img> sends only the cookie; the name is what keeps it private.
  const picture = await app.request(`/api/attachments/${id}`, { headers: { host: HOST, cookie: `prg_${PORT}=${COOKIE}` } });
  expect(picture.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await picture.arrayBuffer())).toEqual(PNG);
  expect((await page("/api/attachments/..%2Fprg.db")).status).toBe(404);

  const missing = `${"0".repeat(64)}.png`;
  expect((await page("/api/messages", post({ kind: "chat", text: "see", images: [missing] }))).status).toBe(400);
  const sent = (await (
    await page("/api/messages", post({ kind: "chat", text: "this looks off", anchor: addedLine, images: [id] }))
  ).json()) as Message;
  expect(sent.images).toEqual([id]);
  expect(await (await session("/api/session/wait")).text()).toContain(`open each with Read: ${join(attachments, id)}`);
});

test("the session gets what was typed, not the editor's escapes, and a long note keeps its screenshots line", async () => {
  const { page, session, post } = setup();
  const { id } = (await (await page("/api/attachments", { method: "POST", body: PNG })).json()) as { id: string };
  await page("/api/messages", post({ kind: "chat", text: "Array&lt;string&gt; in my\\_file.ts &amp;&amp; `a\\_b`", anchor: addedLine }));
  expect(await (await session("/api/session/wait")).text()).toContain("Array<string> in my_file.ts && `a\\_b`");

  await page("/api/messages", post({ kind: "note", text: "x".repeat(3999), anchor: addedLine, images: [id] }));
  await page("/api/messages/send", { method: "POST" });
  expect(await (await session("/api/session/wait")).text()).toContain("open each with Read:");
});
