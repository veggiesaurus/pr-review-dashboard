import { type Author, type PresenceEntry, type Where, whereSchema } from "../shared/messages";

type Seat = { author: Author; where: Where | null; moved: number; since: string };

export function parseWhere(raw: string): Where | null {
  try {
    const parsed = whereSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Who has the review open, by socket. A person on several shows once, at the socket that moved last.
export class Presence {
  private readonly seats = new Map<string, Seat>();
  private clock = 0;

  join(socket: string, author: Author) {
    this.seats.set(socket, { author, where: null, moved: ++this.clock, since: new Date().toISOString() });
  }

  move(socket: string, where: Where) {
    const seat = this.seats.get(socket);
    if (!seat) {
      return;
    }
    if (seat.where && seat.where.hidden !== where.hidden) {
      seat.since = new Date().toISOString();
    }
    seat.where = where;
    seat.moved = ++this.clock;
  }

  leave(socket: string) {
    this.seats.delete(socket);
  }

  // The picture of someone connected, only when it is where GitHub keeps them, since the server fetches it.
  avatarOf(login: string) {
    for (const { author } of this.seats.values()) {
      if (author.login.toLowerCase() === login.toLowerCase() && author.avatar.startsWith("https://avatars.githubusercontent.com/")) {
        return author.avatar;
      }
    }
  }

  list(): PresenceEntry[] {
    const latest = new Map<number, Seat>();
    for (const seat of this.seats.values()) {
      const held = latest.get(seat.author.id);
      if (seat.where && (!held || seat.moved > held.moved)) {
        latest.set(seat.author.id, seat);
      }
    }
    return [...latest.values()].flatMap(({ author, where, since }) => {
      const { role, ...person } = author;
      return where ? [{ person, role, layer: where.layer, tab: where.tab, section: where.section, hidden: where.hidden, since }] : [];
    });
  }
}
