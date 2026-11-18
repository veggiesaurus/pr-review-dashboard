import { connect } from "node:net";

// Writes into the session's inbox; a dead socket from an earlier session is normal, so errors are dropped.
export function wakeSession(socket: string, token: string, text: string) {
  const conn = connect(socket);
  conn.on("error", () => {});
  conn.setTimeout(5000, () => conn.destroy());
  conn.end(`${JSON.stringify({ type: "auth", token })}\n${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`);
}
