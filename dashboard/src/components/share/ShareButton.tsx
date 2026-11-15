import { Check, Copy, Share2 } from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "src/components/ui/avatar";
import { Button } from "src/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "src/components/ui/popover";
import { errorText } from "src/queries/messages.mutation";
import { useShare, useStartShare, useStopShare } from "src/queries/share.query";

// The owner's way to give the review to teammates over a Cloudflare quick tunnel.
export function ShareButton() {
  const { data } = useShare();
  const start = useStartShare();
  const stop = useStopShare();
  const [copied, setCopied] = useState(false);
  const sharing = data?.sharing ?? false;
  const link = data?.link ?? "";
  const unpushed = data?.unpushed && (
    <p className="rounded-md border border-warning/50 bg-warning/15 px-2 py-1.5 text-xs">
      Some of this review's code isn't on GitHub yet, so guests will be reading code that is only on this machine.
    </p>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-transparent px-2 text-muted-foreground text-sm hover:border-border hover:bg-card hover:text-foreground focus-visible:border-border focus-visible:bg-card focus-visible:text-foreground data-[state=open]:border-border data-[state=open]:bg-card"
        >
          <Share2 className="size-4" />
          <span className="max-sm:hidden">Share</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-96 gap-3">
        {sharing ? (
          <>
            <div className="flex gap-2">
              <input
                readOnly
                value={link}
                aria-label="Share link"
                onFocus={event => event.currentTarget.select()}
                className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(link).then(() => setCopied(true));
                }}
              >
                {copied ? <Check /> : <Copy />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">Guests will see every thread on this review.</p>
            {unpushed}
            <div className="grid gap-1.5">
              <h3 className="font-medium text-xs">Signed in</h3>
              {data?.signedIn.length ? (
                <ul className="grid gap-1">
                  {data.signedIn.map(person => (
                    <li key={person.id} className="flex items-center gap-2 text-xs">
                      <Avatar size="xs">
                        <AvatarImage src={`/api/github/avatar/${person.login}`} alt="" />
                        <AvatarFallback>{person.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      {person.name ?? person.login}
                      {person.name && <span className="text-muted-foreground">@{person.login}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-xs">Nobody yet.</p>
              )}
            </div>
            <Button size="sm" variant="outline" className="w-fit" disabled={stop.isPending} onClick={() => stop.mutate()}>
              Stop sharing
            </Button>
            {stop.isError && <p className="text-danger text-xs">{errorText(stop.error)}</p>}
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-xs">
              Share this review with teammates over a Cloudflare quick tunnel, which needs no Cloudflare account. They sign in with GitHub,
              and only collaborators on the repo get in. Guests will see every thread on this review.
            </p>
            {unpushed}
            {data?.blocked ? (
              <p className="rounded-md border bg-muted px-2 py-1.5 text-xs first-letter:uppercase">{data.blocked}.</p>
            ) : (
              <Button size="sm" className="w-fit" disabled={start.isPending} onClick={() => start.mutate()}>
                {start.isPending ? "Starting…" : "Start sharing"}
              </Button>
            )}
            {start.isError && <p className="text-danger text-xs">{errorText(start.error)}</p>}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
