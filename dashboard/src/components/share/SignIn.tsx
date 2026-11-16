import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import type { SignInStatus } from "shared/messages";

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

// What a guest sees until they have signed in with GitHub. Nothing of the review is asked for until then.
export function SignIn() {
  const start = useStartSignIn();
  const { mutate } = start;
  useEffect(() => mutate(), [mutate]);
  const polled = useSignInStatus(start.data?.id).data;
  const status: SignInStatus | undefined = polled ?? start.data;

  useEffect(() => {
    if (status?.state === "done") {
      location.reload();
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
        <p className="text-muted-foreground text-sm">Signed in as @{status.person.login}. Waiting for the owner to let you in.</p>
      )}
      {status?.state === "done" && <p className="text-muted-foreground text-sm">Signed in. Opening the review…</p>}
      {(status?.state === "failed" || start.isError) && (
        <>
          {status?.state === "failed" && <p className="text-danger text-sm">{WHY[status.reason]}</p>}
          <Button className="w-fit" variant="outline" disabled={start.isPending} onClick={() => mutate()}>
            Try again
          </Button>
        </>
      )}
    </main>
  );
}
