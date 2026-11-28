import type { ReactNode } from "react";
import type { IssueLink, Layer } from "shared/payload";

import { IssueRef } from "src/components/links/Issue";
import { Prose } from "src/components/links/Prose";
import { Summary } from "src/components/ui/disclosure";
import { useGithub } from "src/queries/live.query";
import { useViewStore } from "src/store/view.store";
import { ago, fullDate } from "src/utils/dates";

const LINEAR_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const LINK = "text-primary hover:underline";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function Issue({ link, keys }: { link: IssueLink; keys: string[] }) {
  const key = link.ref.toUpperCase();
  if (LINEAR_KEY.test(link.ref) && keys.includes(key)) {
    return <IssueRef issueKey={key} />;
  }
  return link.url?.startsWith("https://") ? (
    <a href={link.url} target="_blank" rel="noreferrer" className={`font-mono text-[12.5px] ${LINK}`}>
      {link.ref}
    </a>
  ) : (
    <span className="font-mono text-[12.5px]">{link.ref}</span>
  );
}

// The issues the PR links, then any it names elsewhere (its branch, say) without linking them.
function Issues({ layer, unlinked }: { layer: Layer; unlinked: string[] }) {
  const groups = [
    { label: "Closes", links: layer.meta.issues.filter(link => link.closes !== false) },
    { label: "Related", links: layer.meta.issues.filter(link => link.closes === false) },
  ].filter(group => group.links.length);
  return (
    <span className="grid gap-1">
      {groups.map(group => (
        <span key={group.label} className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-muted-foreground">{group.label}</span>
          {group.links.map(link => (
            <Issue key={link.ref} link={link} keys={layer.issueKeys} />
          ))}
        </span>
      ))}
      {unlinked.length > 0 && (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Named</span>
          {unlinked.map(key => (
            <IssueRef key={key} issueKey={key} chip />
          ))}
        </span>
      )}
    </span>
  );
}

function Commits({ layer }: { layer: Layer }) {
  const { meta } = layer;
  const setShow = useViewStore(state => state.setShow);
  const setTab = useViewStore(state => state.setTab);
  const owning = new Set(meta.commitMap ? layer.files.flatMap(file => file.hunks.flatMap(hunk => hunk.commits ?? [])) : []);
  const base = meta.url?.startsWith("https://") ? meta.url : null;
  return (
    <details className="motion-expand">
      <Summary className="text-foreground">
        {meta.commits.length} {meta.commits.length === 1 ? "commit" : "commits"}
        {/* Where the branch leaves its base; the head is the last commit listed. */}
        <span className="ml-2 text-muted-foreground text-xs">
          on {meta.base.replace(/^origin\//, "")} at{" "}
          {meta.repo ? (
            <a
              href={`https://github.com/${meta.repo}/commit/${meta.mergeBase}`}
              target="_blank"
              rel="noreferrer"
              className={`font-mono ${LINK}`}
            >
              {meta.mergeBase.slice(0, 7)}
            </a>
          ) : (
            <span className="font-mono">{meta.mergeBase.slice(0, 7)}</span>
          )}
        </span>
      </Summary>
      <ol className="mt-2 grid gap-2 text-xs">
        {meta.commits.map((commit, index) => {
          const [first = "", ...rest] = commit.split("\n");
          const sha = meta.shas[index] ?? "";
          const short = first.slice(0, first.indexOf(" ") > 0 ? first.indexOf(" ") : 7);
          const subject = first.slice(short.length).trim();
          const body = rest.join("\n").trim();
          return (
            <li key={sha || index} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
              {base && sha ? (
                <a href={`${base}/commits/${sha}`} target="_blank" rel="noreferrer" className={`font-mono ${LINK}`}>
                  {short}
                </a>
              ) : (
                <span className="font-mono text-muted-foreground">{short}</span>
              )}
              <span>
                <Prose text={subject} layer={layer.id} />
                {owning.has(index) && (
                  <button
                    type="button"
                    className="ml-2 cursor-pointer text-muted-foreground text-xs hover:text-primary hover:underline"
                    onClick={() => {
                      setShow({ kind: "commit", index });
                      setTab("guide");
                    }}
                  >
                    show its changes
                  </button>
                )}
              </span>
              {body && (
                <p className="col-start-2 mt-0.5 whitespace-pre-wrap text-muted-foreground">
                  <Prose text={body} layer={layer.id} />
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

// The PR's facts, one above another to suit the narrow status column: where it is, when it was opened, who wrote it,
// the branches, the commits and the issues it names.
export function PrDetails({ layer }: { layer: Layer }) {
  const { meta } = layer;
  const ref = meta.number ? `${meta.repo}#${meta.number}` : meta.repo;
  // GitHub's, so a branch with no PR yet has no date to show.
  const opened = useGithub(layer.id, layer.capabilities.github).data?.pr?.openedAt;
  const linked = new Set(meta.issues.map(issue => issue.ref.toUpperCase()));
  const unlinked = layer.issueKeys.filter(key => !linked.has(key));
  return (
    <dl className="grid gap-3 rounded-lg border bg-card p-4 text-sm shadow-xs" aria-label="Pull request">
      {ref && (
        <Row label={meta.number ? "Pull request" : "Repository"}>
          {meta.url?.startsWith("https://") ? (
            <a href={meta.url} target="_blank" rel="noreferrer" className={LINK}>
              {ref}
            </a>
          ) : (
            ref
          )}
          {opened && (
            <span className="block text-muted-foreground text-xs" title={fullDate(opened)}>
              opened {ago(opened)}
            </span>
          )}
        </Row>
      )}
      {meta.author && <Row label="Author">{meta.author}</Row>}
      <Row label="Branches">
        <span className="font-mono text-[12.5px]">
          {meta.base} ← {meta.head}
        </span>
      </Row>
      {meta.commits.length > 0 && (
        <Row label="Commits">
          <Commits layer={layer} />
        </Row>
      )}
      {(meta.issues.length > 0 || unlinked.length > 0) && (
        <Row label="Issues">
          <Issues layer={layer} unlinked={unlinked} />
        </Row>
      )}
    </dl>
  );
}
