import { HTTPError } from "ky";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "src/components/ui/button";
import { errorText } from "src/queries/messages.mutation";
import { useSignInStatus, useSignInWith, useStartSignIn } from "src/queries/share.query";
import { copyToClipboard } from "src/utils/clipboard";

const WHY = {
  expired: "That sign-in ran out before you were let in.",
  denied: "Sign-in was cancelled on GitHub.",
  "turned-away": "The owner didn't let you in.",
  "not-collaborator": "You need access to this repository on GitHub.",
  error: "Something went wrong signing you in.",
} as const;

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="rounded-md border bg-muted px-3 py-1.5 font-mono text-2xl tracking-widest">{code}</code>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          copyToClipboard(code).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

// The sign-in this tab started, so a reload while waiting carries on with it rather than asking for GitHub again.
const KEPT = "prg:signin";
function kept() {
  try {
    return sessionStorage.getItem(KEPT) ?? undefined;
  } catch {
    return undefined;
  }
}
function keep(id: string | null) {
  try {
    if (id) {
      sessionStorage.setItem(KEPT, id);
    } else {
      sessionStorage.removeItem(KEPT);
    }
  } catch {
    // Without storage a reload just starts a new sign-in.
  }
}

// What a guest sees until they are let in. Nothing of the review is asked for until then.
export function SignIn() {
  const how = useSignInWith();
  const byName = how.data?.with === "name";
  const start = useStartSignIn();
  const { mutate, reset } = start;
  const [resumed, setResumed] = useState(kept);
  const [name, setName] = useState("");
  const id = start.data?.id ?? resumed;
  const check = useSignInStatus(id);
  const status = check.data ?? (start.data?.id === id ? start.data : undefined);
  // The server forgets a sign-in when it restarts or the sign-in runs out.
  const gone = check.error instanceof HTTPError && check.error.response.status === 404;

  const begin = useCallback(
    (typed?: string) => {
      keep(null);
      setResumed(undefined);
      mutate(typed, { onSuccess: data => keep(data.id) });
    },
    [mutate],
  );
  // A guest who typed a name types it again, rather than being sent off with a new code.
  const restart = useCallback(() => {
    keep(null);
    setResumed(undefined);
    reset();
  }, [reset]);

  useEffect(() => {
    if (how.data?.with === "github" && ((!id && start.isIdle) || gone)) {
      begin();
    } else if (byName && gone) {
      restart();
    }
  }, [how.data?.with, byName, id, start.isIdle, gone, begin, restart]);

  useEffect(() => {
    if (status?.state === "done") {
      keep(null);
      location.reload();
    } else if (status?.state === "failed") {
      keep(null);
    }
  }, [status?.state]);

  return (
    <main className="mx-auto grid min-h-screen max-w-md content-center gap-4 px-4 font-sans">
      <h1 className="font-serif text-2xl">Sign in to read this review</h1>
      {how.isError && <p className="text-danger text-sm">Couldn't reach the review ({errorText(how.error, "no answer")}).</p>}
      {start.isError && <p className="text-danger text-sm">{errorText(start.error)}</p>}
      {byName && !id && (
        <form
          className="grid gap-3"
          onSubmit={event => {
            event.preventDefault();
            begin(name.trim());
          }}
        >
          <p className="text-muted-foreground text-sm">Type your name, and the owner will let you in.</p>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              maxLength={40}
              autoComplete="name"
              aria-label="Your name"
              placeholder="Your name"
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
            />
            <Button type="submit" disabled={!name.trim() || start.isPending}>
              Ask to come in
            </Button>
          </div>
        </form>
      )}
      {status?.state === "pending" && (
        <>
          <p className="text-muted-foreground text-sm">Open GitHub, enter this code, and approve. It only reads who you are.</p>
          <CopyCode code={status.userCode} />
          <Button className="w-fit" onClick={() => window.open("https://github.com/login/device", "_blank", "noopener")}>
            <ExternalLink />
            Open GitHub
          </Button>
          <p className="text-muted-foreground text-sm">Waiting for you to approve it on GitHub…</p>
        </>
      )}
      {status?.state === "waiting" && (
        <>
          <p className="text-muted-foreground text-sm">
            {status.person.login ? `Signed in as @${status.person.login}. ` : ""}Waiting for the owner to let you in; keep this page open.
            They see this code beside your name, and may ask you for it:
          </p>
          <code className="w-fit rounded-md border bg-muted px-3 py-1.5 font-mono text-2xl tracking-widest">{status.code}</code>
        </>
      )}
      {check.isError && !gone && (
        <>
          <p className="text-danger text-sm">
            Couldn't reach the review to check your sign-in ({errorText(check.error, "no answer")}). If this keeps happening, open the share
            link again.
          </p>
          <Button className="w-fit" variant="outline" disabled={check.isFetching} onClick={() => check.refetch()}>
            Check again
          </Button>
        </>
      )}
      {status?.state === "done" && <p className="text-muted-foreground text-sm">Signed in. Opening the review…</p>}
      {(status?.state === "failed" || (start.isError && !byName)) && (
        <>
          {status?.state === "failed" && <p className="text-danger text-sm">{WHY[status.reason]}</p>}
          <Button className="w-fit" variant="outline" disabled={start.isPending} onClick={() => (byName ? restart() : begin())}>
            Try again
          </Button>
        </>
      )}
    </main>
  );
}
