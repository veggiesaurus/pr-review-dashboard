const DAY = 86_400_000;
const relative = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
const sameYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const otherYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const full = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

// Linear's due dates have no time, and a bare date would otherwise be read as UTC and can land on the day before.
const parse = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00` : iso);

export function shortDay(iso: string, now = new Date()): string {
  const date = parse(iso);
  return (date.getFullYear() === now.getFullYear() ? sameYear : otherYear).format(date);
}

export const fullDate = (iso: string) => full.format(parse(iso));

export const isPast = (day: string, now = Date.now()) => parse(day).getTime() + DAY <= now;

export const isNow = (from: string, to: string, now = Date.now()) => parse(from).getTime() <= now && now < parse(to).getTime();

export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.round((parse(iso).getTime() - now) / 60_000);
  if (Math.abs(minutes) < 60) {
    return relative.format(minutes, "minute");
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return relative.format(hours, "hour");
  }
  const days = Math.round(hours / 24);
  return Math.abs(days) < 60 ? relative.format(days, "day") : relative.format(Math.round(days / 30), "month");
}
