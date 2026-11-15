import { useEffect, useState } from "react";
import type { PresenceEntry } from "shared/messages";

import { land } from "src/components/guide/nav";
import { Avatar, AvatarFallback, AvatarImage } from "src/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "src/components/ui/tooltip";
import { useViewStore } from "src/store/view.store";
import { sectionElementId } from "src/utils/anchors";
import { cn } from "src/utils/cn";

const AWAY_MS = 120_000;

function visit({ layer, tab, section }: PresenceEntry) {
  const { setLayer, setTab } = useViewStore.getState();
  setLayer(layer, true);
  setTab(tab);
  if (section !== null) {
    // The tab may need a frame to draw before its section exists.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const element = document.getElementById(sectionElementId(layer, section));
        if (element) {
          land(element, false);
        }
      }),
    );
  }
}

function One({ entry, size }: { entry: PresenceEntry; size: "sm" | "md" }) {
  const { person, hidden, since } = entry;
  const [away, setAway] = useState(false);
  useEffect(() => {
    const wait = Date.parse(since) + AWAY_MS - Date.now();
    if (!hidden) {
      setAway(false);
      return;
    }
    setAway(wait <= 0);
    if (wait > 0) {
      const timer = setTimeout(() => setAway(true), wait);
      return () => clearTimeout(timer);
    }
  }, [hidden, since]);
  const label = person.name ?? person.login;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => visit(entry)}
          aria-label={`${label}, ${away ? "away" : "reading"}`}
          data-presence={person.login}
          className={cn("cursor-pointer rounded-full ring-2 ring-background", away && "opacity-40")}
        >
          <Avatar size={size === "sm" ? "xs" : "sm"}>
            <AvatarImage src={`/api/github/avatar/${person.login}`} alt="" />
            <AvatarFallback>{person.login.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Avatars({ people, size }: { people: PresenceEntry[]; size: "sm" | "md" }) {
  if (!people.length) {
    return null;
  }
  return (
    <span className="inline-flex items-center -space-x-1">
      {people.map(entry => (
        <One key={entry.person.id} entry={entry} size={size} />
      ))}
    </span>
  );
}
