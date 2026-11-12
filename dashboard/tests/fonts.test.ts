import { describe, expect, test } from "bun:test";

import { fontFaces } from "../server/routes/fonts";
import { COOKIE, HOST, ORIGIN, PORT, setup } from "./helpers";

const FILE = "s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2";
const SHEET = `/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/${FILE}) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  src: url(https://elsewhere.example/font.woff2) format('woff2');
}
body { background: url(https://elsewhere.example/seen) }`;

describe("fonts", () => {
  test("Google's stylesheet is rebuilt face by face, so only its own font files reach the page", () => {
    const faces = fontFaces("Inter", SHEET);
    expect(faces).toBe(
      `@font-face{font-family:"Inter";font-style:normal;font-weight:400;font-display:swap;src:url(/api/fonts/file/${FILE}) format("woff2");unicode-range:U+0000-00FF, U+0131;}`,
    );
  });

  test("the page names a family or a file of a known shape, and only the two font hosts are ever asked", async () => {
    const asked: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      asked.push(String(url));
      return String(url).startsWith("https://fonts.googleapis.com/")
        ? new Response(SHEET, { headers: { "content-type": "text/css" } })
        : new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-type": String(url).endsWith("bad.woff2") ? "text/html" : "font/woff2" },
          });
    }) as typeof fetch;
    const { app, page } = setup({ fetcher });
    const cookieOnly = (path: string) => app.request(path, { headers: { host: HOST, origin: ORIGIN, cookie: `prg_${PORT}=${COOKIE}` } });

    expect((await page("/api/fonts/css?family=Inter%3Bx")).status).toBe(400);
    expect((await page("/api/fonts/file/../../secret")).status).not.toBe(200);
    expect((await page("/api/fonts/file/s/inter/v20/bad.woff2")).status).toBe(404);
    expect((await cookieOnly("/api/fonts/css?family=Inter")).status).toBe(401);

    const sheet = await page("/api/fonts/css?family=Inter");
    expect(await sheet.text()).toContain(`/api/fonts/file/${FILE}`);
    // A stylesheet can't send the page's key, so the file is all a cookie alone gets.
    const file = await cookieOnly(`/api/fonts/file/${FILE}`);
    expect(file.headers.get("content-type")).toBe("font/woff2");
    expect(asked.every(url => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url))).toBe(true);
  });
});
