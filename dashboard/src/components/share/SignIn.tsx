import { HTTPError } from "ky";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "src/components/ui/button";
import { errorText } from "src/queries/messages.mutation";
import { useSignInStatus, useStartSignIn } from "src/queries/share.query";

const WHY = {
  expired: "That code ran out before it was used.",
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
          void navigator.clipboard?.writeText(code).then(() => setCopied(true));
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

// What a guest sees until they have signed in with GitHub. Nothing of the review is asked for until then.
export function SignIn() {
  const start = useStartSignIn();
  const { mutate } = start;
  const [resumed, setResumed] = useState(kept);
  const id = start.data?.id ?? resumed;
  const check = useSignInStatus(id);
  const status = check.data ?? (start.data?.id === id ? start.data : undefined);
  // The server forgets a sign-in when it restarts or the sign-in runs out.
  const gone = check.error instanceof HTTPError && check.error.response.status === 404;

  const begin = useCallback(() => {
    keep(null);
    setResumed(undefined);
    mutate(undefined, { onSuccess: data => keep(data.id) });
  }, [mutate]);

  useEffect(() => {
    if ((!id && start.isIdle) || gone) {
      begin();
    }
  }, [id, start.isIdle, gone, begin]);

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
      {start.isError && <p className="text-danger text-sm">{errorText(start.error)}</p>}
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
        <p className="text-muted-foreground text-sm">
          Signed in as @{status.person.login}. Waiting for the owner to let you in; keep this page open.
        </p>
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
      {(status?.state === "failed" || start.isError) && (
        <>
          {status?.state === "failed" && <p className="text-danger text-sm">{WHY[status.reason]}</p>}
          <Button className="w-fit" variant="outline" disabled={start.isPending} onClick={begin}>
            Try again
          </Button>
        </>
      )}
    </main>
  );
}
