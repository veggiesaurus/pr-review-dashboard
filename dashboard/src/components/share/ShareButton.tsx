import { Check, Copy, Share2 } from "lucide-react";
import { useState } from "react";

import type { Person } from "shared/messages";

import { handleOf, PersonFace } from "src/components/links/Github";
import { Button } from "src/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "src/components/ui/popover";
import { errorText } from "src/queries/messages.mutation";
import { useAnswerGuest, useOwnerLink, useShare, useStartShare, useStopShare } from "src/queries/share.query";

function Who({ person }: { person: Person }) {
  return (
    <div className="flex items-center gap-2">
      <PersonFace person={person} />
      {person.name ?? person.login}
      {person.name && person.login && <span className="text-muted-foreground">@{person.login}</span>}
      {!person.login && <span className="text-muted-foreground">(typed name)</span>}
    </div>
  );
}

function CopyLink({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        readOnly
        value={url}
        aria-label={label}
        onFocus={event => event.currentTarget.select()}
        className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs"
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => setCopied(true));
        }}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

// The owner's link opens once, so a phone or a second browser gets a link of its own from here.
function AnotherDevice() {
  const make = useOwnerLink();
  return (
    <div className="grid gap-1.5 border-t pt-3">
      <h3 className="font-medium text-xs">Open on another device</h3>
      <p className="text-muted-foreground text-xs">Each link works once and makes that browser the owner, so keep it to yourself.</p>
      {make.data ? (
        <ul className="grid gap-2">
          {make.data.links.map(link => (
            <li key={link.url} className="grid gap-1 text-xs">
              {link.label}
              <CopyLink label={link.label} url={link.url} />
            </li>
          ))}
        </ul>
      ) : (
        <Button size="sm" variant="outline" className="w-fit" disabled={make.isPending} onClick={() => make.mutate()}>
          Make a link
        </Button>
      )}
      {make.isError && <p className="text-danger text-xs">{errorText(make.error)}</p>}
    </div>
  );
}

// The owner's way to give the review to teammates over a Cloudflare quick tunnel.
export function ShareButton() {
  const { data } = useShare();
  const start = useStartShare();
  const stop = useStopShare();
  const answer = useAnswerGuest();
  const [copied, setCopied] = useState(false);
  const sharing = data?.sharing ?? false;
  const link = data?.link ?? "";
  const waiting = data?.waiting ?? [];
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
          // The word is hidden on a phone, which would leave the button with no name.
          aria-label={waiting.length ? `Share, ${waiting.length} waiting to be let in` : "Share"}
          className="flex h-7 cursor-pointer items-center gap-1.5 rounded-full pointer-coarse:h-11 pointer-coarse:px-3 border border-transparent px-2 text-muted-foreground text-sm hover:border-border hover:bg-card hover:text-foreground focus-visible:border-border focus-visible:bg-card focus-visible:text-foreground data-[state=open]:border-border data-[state=open]:bg-card"
        >
          <Share2 className="size-4" />
          <span className="max-[100rem]:hidden">Share</span>
          {waiting.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-primary-foreground text-xs leading-4">{waiting.length}</span>
          )}
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
            {waiting.length > 0 && (
              <div className="grid gap-1.5">
                <h3 className="font-medium text-xs">Waiting to join</h3>
                <ul className="grid gap-2">
                  {waiting.map(guest => {
                    const where = [
                      guest.country && new Intl.DisplayNames(undefined, { type: "region" }).of(guest.country),
                      guest.browser,
                      guest.alreadyIn && (guest.person.login ? "already in from another browser" : "someone with this name is already in"),
                    ].filter(Boolean);
                    return (
                      <li key={guest.id} className="grid gap-1 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <Who person={guest.person} />
                          <span title="Their page shows this code too. Check it with them before letting them in.">
                            Code <span className="font-mono font-medium text-sm tracking-wider">{guest.code}</span>
                          </span>
                        </div>
                        {where.length > 0 && <p className="text-muted-foreground">{where.join(" · ")}</p>}
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={answer.isPending}
                            aria-label={`Let in ${handleOf(guest.person)}`}
                            onClick={() => answer.mutate({ id: guest.id, allow: true })}
                          >
                            Let in
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={answer.isPending}
                            aria-label={`Turn away ${handleOf(guest.person)}`}
                            onClick={() => answer.mutate({ id: guest.id, allow: false })}
                          >
                            Turn away
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {answer.isError && <p className="text-danger text-xs">{errorText(answer.error)}</p>}
              </div>
            )}
            <div className="grid gap-1.5">
              <h3 className="font-medium text-xs">Signed in</h3>
              {data?.signedIn.length ? (
                <ul className="grid gap-1">
                  {data.signedIn.map(person => (
                    <li key={person.id} className="text-xs">
                      <Who person={person} />
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
              Share this review with teammates over a Cloudflare quick tunnel, which needs no Cloudflare account.{" "}
              {data?.signInWith === "name"
                ? "They type their name, and nothing checks it's theirs, so check the code beside each one with them before you let them in."
                : "They sign in with GitHub, only collaborators on the repo can, and you let each one in."}{" "}
              Guests will see every thread on this review.
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
        <AnotherDevice />
      </PopoverContent>
    </Popover>
  );
}
