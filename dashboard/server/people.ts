import { randomBytes } from "node:crypto";

import type { Person } from "../shared/messages";

// Who the server knows: the owner, and each guest by the session id in their cookie.
export class People {
  owner: Person | null = null;
  private sessions = new Map<string, Person>();

  issue(person: Person) {
    const id = randomBytes(24).toString("hex");
    this.sessions.set(id, person);
    return id;
  }

  find(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  // Once each, though one person may be signed in from several browsers.
  signedIn() {
    return [...new Map([...this.sessions.values()].map(person => [person.id, person])).values()];
  }

  revokeAll() {
    this.sessions.clear();
  }
}
