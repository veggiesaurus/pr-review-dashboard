import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";

import { activitySchema, archiveSchema, attentionSchema, editSchema, newMessageSchema, replySchema } from "../../shared/messages";
import type { AppDeps } from "../app";
import { type Env, only, small } from "../guards";
import { hasAttachment } from "./attachments";

export function messagesRoutes(deps: AppDeps) {
  const { store } = deps;
  const app = new Hono<Env>();

  app.get("/session", c => c.json(store.session));

  // The session says what it is doing now, optionally for one thread; an empty line says it has stopped.
  app.post("/activity", only("session"), small, zValidator("json", activitySchema), c => {
    const { text, replyTo } = c.req.valid("json");
    store.heard();
    store.setAttention("");
    store.setActivity(text, replyTo);
    return c.json(store.session);
  });

  // The plugin's hooks say when the session stops at a permission prompt in its terminal, and when it moves on.
  app.post("/attention", only("session"), small, zValidator("json", attentionSchema), c => {
    store.setAttention(c.req.valid("json").text);
    return c.json(store.session);
  });

  app.get("/messages", c => c.json(store.messages));

  app.post("/messages", only("page"), small, zValidator("json", newMessageSchema), c => {
    const input = c.req.valid("json");
    if (input.images?.some(id => !hasAttachment(deps.attachments, id))) {
      return c.json({ error: "an attached screenshot isn't on the server; attach it again" }, 400);
    }
    const message = store.addUserMessage(input);
    return message ? c.json(message, 201) : c.json({ error: "that anchor or message isn't in this review" }, 400);
  });

  app.post("/messages/send", only("page"), c => c.json({ sent: store.sendDrafts(), listening: store.listening }));

  app.patch("/messages/:id", only("page"), small, zValidator("json", editSchema), c => {
    const draft = store.editDraft(c.req.param("id"), c.req.valid("json").text);
    return draft ? c.json(draft) : c.json({ error: "no such draft" }, 404);
  });

  app.post("/messages/:id/archive", only("page"), small, zValidator("json", archiveSchema), c => {
    const { archived, reason } = c.req.valid("json");
    const thread = store.setArchived(c.req.param("id"), archived, reason);
    return thread ? c.json(thread) : c.json({ error: "no such thread" }, 404);
  });

  app.post("/messages/:id/seen", only("page"), c => {
    const thread = store.markSeen(c.req.param("id"));
    return thread ? c.json(thread) : c.json({ error: "no such thread" }, 404);
  });

  app.delete("/messages/:id", only("page"), c =>
    store.deleteDraft(c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "no such draft" }, 404),
  );

  // 201 with Claude's message when there is text, else 200 with the thread whose state changed.
  app.post("/replies", only("session"), small, zValidator("json", replySchema), c => {
    store.heard();
    store.setAttention("");
    const result = store.addReply(c.req.valid("json"));
    if (!result) {
      return c.json({ error: "no message with that id" }, 404);
    }
    return result.message ? c.json(result.message, 201) : c.json(result.thread, 200);
  });

  app.get("/session/wait", only("session"), async c => c.text(await store.wait(c.req.raw.signal)));

  app.get(
    "/session/ws",
    only("session"),
    upgradeWebSocket(() => {
      let remove = () => {};
      return {
        onOpen(_event, ws) {
          remove = store.addSessionSink(frame => ws.send(frame));
        },
        // A listener that can write says so after each frame it has passed on; Monitor's own socket can't.
        onMessage() {
          store.heard(1);
        },
        onClose() {
          remove();
        },
      };
    }),
  );

  app.get(
    "/ws",
    only("page"),
    upgradeWebSocket(() => {
      let remove = () => {};
      return {
        onOpen(_event, ws) {
          remove = store.addPageSink(push => ws.send(JSON.stringify(push)));
        },
        onClose() {
          remove();
        },
      };
    }),
  );

  return app;
}
