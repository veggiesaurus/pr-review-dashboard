import { Database } from "bun:sqlite";
import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

// A message is written once, as JSON in body. What a query wants is a column generated from it, so the two can't
// disagree; the anchor stays in body, since its shape depends on what the thread is about.
const MESSAGE_COLUMNS: Record<string, [type: string, from: string]> = {
  id: ["text", "'m' || n"],
  reply_to: ["text", "body ->> '$.replyTo'"],
  sender: ["text", "body ->> '$.from'"],
  kind: ["text", "body ->> '$.kind'"],
  status: ["text", "body ->> '$.status'"],
  state: ["text", "body ->> '$.state'"],
  resolved: ["integer", "body ->> '$.resolved'"],
  archived: ["integer", "coalesce(body ->> '$.archived', 0)"],
  at: ["text", "body ->> '$.at'"],
  text: ["text", "body ->> '$.text'"],
  review: ["integer", "body ->> '$.review.n'"],
  severity: ["text", "body ->> '$.review.severity'"],
  // The PR a thread is about, and the file when it is about code.
  layer: ["integer", "body ->> '$.anchor.layer'"],
  path: ["text", "body ->> '$.anchor.path'"],
};

// One file for every review on this machine, readable only by the user. Without a path it lives in memory.
export function openDb(path?: string) {
  if (path) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    closeSync(openSync(path, "a", 0o600));
    chmodSync(path, 0o600);
  }
  const db = new Database(path ?? ":memory:", { strict: true });
  db.run("pragma busy_timeout = 2000");
  db.run(`
    create table if not exists messages (n integer primary key autoincrement, pr text not null, stack text, body text not null);
    create index if not exists messages_pr on messages (pr);
    create table if not exists ticks (key text primary key);
    create table if not exists frames (n integer primary key autoincrement, pr text not null, stack text, frame text not null, ids text not null);
  `);
  // Two servers can start at once on the same file, so the check and the change are one write transaction.
  db.transaction(() => {
    const have = new Set(
      db
        .query<{ name: string }, []>("select name from pragma_table_xinfo('messages')")
        .all()
        .map(row => row.name),
    );
    for (const [name, [type, from]] of Object.entries(MESSAGE_COLUMNS)) {
      if (!have.has(name)) {
        db.run(`alter table messages add column ${name} ${type} generated always as (${from}) virtual`);
      }
    }
  }).immediate();
  return db;
}
