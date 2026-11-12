// Prints each frame the review page sends to the session, and tells the server it has. The token stays in the state file.
// Usage: bun scripts/listen.mjs STATE.json
import { readFileSync } from "node:fs";

const state = JSON.parse(readFileSync(process.argv[2], "utf8"));
const socket = new WebSocket(`ws://127.0.0.1:${state.port}/api/session/ws?t=${state.token}`);
socket.onmessage = event => {
  console.log(String(event.data));
  // Any message back says the frame above got this far; without it the server sends the frame again.
  socket.send("ok");
};
socket.onerror = () => console.log("[listener] socket error");
socket.onclose = event => {
  console.log(`[listener] socket closed (${event.code})`);
  process.exit(0);
};
