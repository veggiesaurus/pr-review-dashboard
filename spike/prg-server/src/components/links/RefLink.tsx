import type { ReactNode } from "react";
import type { Ref } from "shared/refs";

import { GithubRef } from "src/components/links/Github";
import { IssueRef } from "src/components/links/Issue";

// A reference or web link in text: Linear and GitHub ones preview on hover, any other https link is just a link.
export function RefLink({
  reference,
  text,
  href,
  repo,
  className,
}: {
  reference: Ref | null;
  text: ReactNode;
  href: string | null;
  repo: string | null;
  className?: string;
}) {
  if (reference?.kind === "linear") {
    return <IssueRef issueKey={reference.key} label={text} href={href} className={className} />;
  }
  if (reference) {
    return <GithubRef reference={reference} text={text} href={href} repo={repo} className={className} />;
  }
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {text}
    </a>
  ) : (
    text
  );
}
