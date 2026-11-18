import { randomBytes } from "node:crypto";

import { splitMentions } from "../shared/mentions";
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

  known() {
    return [...(this.owner ? [this.owner] : []), ...this.signedIn()].filter((p, i, all) => all.findIndex(q => q.id === p.id) === i);
  }

  revokeAll() {
    this.sessions.clear();
  }
}

// Ids of the people named as @login or @Full Name; where one handle starts another, the longer is the one named.
export function mentionsIn(text: string, people: Person[]): number[] {
  const named = new Set(
    splitMentions(
      text,
      people.flatMap(p => p.login || p.name || []),
    )
      .filter((_, i) => i % 2)
      .map(handle => handle.toLowerCase()),
  );
  return people.filter(p => named.has((p.login || p.name || "").toLowerCase())).map(p => p.id);
}
