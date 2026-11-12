import { describe, expect, test } from "bun:test";

import { issueKeys } from "../server/linear";
import { LINEAR_KEY, setup } from "./helpers";

describe("Linear", () => {
  test("issue keys come from the title, the branch and the linked issues", () => {
    const meta = { title: "ABC-12 and abc-12 again", head: "angus/da-3692-bcrypt", issues: [{ ref: "BAC-1087" }, { ref: 7 }] };
    expect(issueKeys(meta)).toEqual(["ABC-12", "DA-3692", "BAC-1087"]);
  });

  test("Linear is only asked about issues the pull request names, and the key stays on the server", async () => {
    const calls: { url: string; auth: string | null; body: string }[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body: String(init?.body) });
      return Response.json({
        data: {
          issue: {
            identifier: "ABC-12",
            title: "Move slugs",
            url: "https://linear.app/acme/issue/ABC-12",
            state: { name: "In Review", type: "started" },
          },
        },
      });
    }) as typeof fetch;
    const { page } = setup({ fetcher });

    expect((await page("/api/linear/XYZ-1")).status).toBe(404);
    expect(calls).toHaveLength(0);

    const response = await page("/api/linear/ABC-12");
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ issue: { identifier: "ABC-12", state: "In Review", assignee: null }, reason: null });
    expect(text).not.toContain(LINEAR_KEY);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://api.linear.app/graphql", auth: LINEAR_KEY });
    expect(JSON.parse(calls[0]?.body ?? "{}").variables).toEqual({ id: "ABC-12" });

    await page("/api/linear/ABC-12");
    expect(calls).toHaveLength(1);
  });

  test("the page gets a person's picture by issue and role, fetched without the key and without learning its address", async () => {
    const PNG = new Uint8Array([137, 80, 78, 71]);
    const calls: { url: string; auth: string | null }[] = [];
    const person = (name: string, avatarUrl: string | null) => ({
      displayName: name,
      initials: "ZZ",
      avatarUrl,
      avatarBackgroundColor: "#ff78ae",
    });
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      switch (String(url)) {
        case "https://api.linear.app/graphql":
          return Response.json({
            data: {
              issue: {
                identifier: "ABC-12",
                title: "Move slugs",
                url: "https://linear.app/acme/issue/ABC-12",
                estimate: 3,
                description:
                  "## Ask\n\n* See the [thread](<https://chat.example/p1>) ![shot](https://uploads.example/a.png)\n* Keep `da_tools` **stable**",
                state: { name: "In Review", type: "started", color: "#f2c94c" },
                assignee: person("thandi", "https://public.linear.app/thandi"),
                creator: person("sipho", "https://gravatar.example/sipho"),
                project: { name: "Blog", url: "https://linear.app/acme/project/blog", color: "red;background:url(//evil.example)" },
                labels: { nodes: [{ name: "Bug", color: "#eb5757" }] },
                children: { nodes: [{ state: { type: "completed" } }, { state: { type: "started" } }] },
              },
            },
          });
        case "https://public.linear.app/thandi":
          return new Response(null, { status: 302, headers: { location: "https://cdn.example/thandi.png" } });
        case "https://cdn.example/thandi.png":
          return new Response(PNG, { headers: { "content-type": "image/png, text/html" } });
        case "https://gravatar.example/sipho":
          return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:9/private" } });
        default:
          return new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } });
      }
    }) as typeof fetch;
    const { page } = setup({ fetcher });

    const text = await (await page("/api/linear/ABC-12")).text();
    expect(JSON.parse(text).issue).toMatchObject({
      estimate: 3,
      description: "Ask See the thread Keep da_tools stable",
      stateColor: "#f2c94c",
      assignee: { name: "thandi", initials: "ZZ", color: "#ff78ae", avatar: true },
      project: { name: "Blog", color: null },
      labels: [{ name: "Bug", color: "#eb5757" }],
      subIssues: { total: 2, done: 1 },
    });
    expect(text).not.toContain("public.linear.app");

    const picture = await page("/api/linear/ABC-12/avatar/assignee");
    expect(picture.status).toBe(200);
    expect(picture.headers.get("content-type")).toBe("image/png");
    expect(picture.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(new Uint8Array(await picture.arrayBuffer())).toEqual(PNG);

    expect((await page("/api/linear/ABC-12/avatar/creator")).status).toBe(404);
    expect((await page("/api/linear/ABC-12/avatar/team")).status).toBe(404);
    expect((await page("/api/linear/XYZ-1/avatar/assignee")).status).toBe(404);

    const pictures = calls.filter(call => call.url !== "https://api.linear.app/graphql");
    expect(pictures.map(call => call.url)).toEqual([
      "https://public.linear.app/thandi",
      "https://cdn.example/thandi.png",
      "https://gravatar.example/sipho",
    ]);
    expect(pictures.every(call => call.auth === null)).toBe(true);
  });

  test("a picture that isn't a plain image is refused", async () => {
    const fetcher = (async (url: string | URL | Request) =>
      String(url) === "https://api.linear.app/graphql"
        ? Response.json({
            data: {
              issue: {
                identifier: "ABC-12",
                title: "Move slugs",
                url: "https://linear.app/acme/issue/ABC-12",
                assignee: { displayName: "thandi", avatarUrl: "https://public.linear.app/thandi" },
              },
            },
          })
        : new Response("<svg onload='x'/>", { headers: { "content-type": "image/svg+xml" } })) as typeof fetch;
    const { page } = setup({ fetcher });
    expect((await page("/api/linear/ABC-12/avatar/assignee")).status).toBe(404);
  });

  test("a picture on an address or a local name isn't fetched, and one that's too big stops being read", async () => {
    const asked: string[] = [];
    let pulled = 0;
    const endless = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
      });
    const fetcher = (async (url: string | URL | Request) => {
      asked.push(String(url));
      return String(url) === "https://api.linear.app/graphql"
        ? Response.json({
            data: {
              issue: {
                identifier: "ABC-12",
                title: "Move slugs",
                url: "https://linear.app/acme/issue/ABC-12",
                assignee: { displayName: "thandi", avatarUrl: "https://127.0.0.1:8443/private" },
                creator: { displayName: "sipho", avatarUrl: "https://public.linear.app/sipho" },
              },
            },
          })
        : new Response(endless(), { headers: { "content-type": "image/png" } });
    }) as typeof fetch;
    const { page } = setup({ fetcher });
    expect((await page("/api/linear/ABC-12/avatar/assignee")).status).toBe(404);
    expect((await page("/api/linear/ABC-12/avatar/creator")).status).toBe(404);
    expect(asked).toEqual(["https://api.linear.app/graphql", "https://public.linear.app/sipho"]);
    expect(pulled).toBeLessThan(8);
  });
});
