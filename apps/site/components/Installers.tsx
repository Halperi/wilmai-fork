"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FirstStartVisual } from "./FirstStartVisual";

export interface Installer {
  kind: "mac" | "windows";
  name: string;
  detail: string;
  /** Through wilm.ai (/get/…), or null while it's coming. */
  url: string | null;
  /** What the computer does the first time, and what to choose. */
  note: string;
  visualTitle: string;
  steps?: { download: string; start: string };
}

/**
 * The download buttons, with the steps of installing shown after the click, for the platform downloaded: the
 * warnings an unsigned app gets read as a reason not to try when they come first. Anyone who wants to read them before
 * can open "How installing works" (a plain <details>, so it works without JavaScript too).
 */
export function Installers({ installers, beta, labels }: {
  installers: Installer[];
  beta: ReactNode;
  labels: { download: string; coming: string; started: string; howTo: string };
}) {
  const [started, setStarted] = useState<Installer["kind"] | null>(null);
  const next = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (started) next.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [started]);
  const chosen = installers.find((i) => i.kind === started);
  const steps = (i: Installer) => (
    <>
      <p>{i.note}</p>
      <FirstStartVisual kind={i.kind} title={i.visualTitle} steps={i.steps} />
    </>
  );

  return (
    <>
      {installers.map((i) => (
        <div className="home-installer" key={i.kind}>
          <div>
            <h3>{i.name} {beta}</h3>
            <p>{i.detail}</p>
          </div>
          {i.url ? (
            // The link downloads the installer; the page stays and shows what comes next.
            <a className="button primary" href={i.url} rel="nofollow" onClick={() => setStarted(i.kind)}>{labels.download} ↓</a>
          ) : (
            <span className="button secondary is-disabled" aria-disabled="true">{labels.coming}</span>
          )}
        </div>
      ))}
      {chosen ? (
        <div className="install-next" ref={next} role="status">
          <h3>{labels.started}</h3>
          {steps(chosen)}
        </div>
      ) : null}
      <details className="install-help">
        <summary>{labels.howTo}</summary>
        {installers.filter((i) => i.kind !== started).map((i) => <div key={i.kind}>{steps(i)}</div>)}
      </details>
    </>
  );
}
