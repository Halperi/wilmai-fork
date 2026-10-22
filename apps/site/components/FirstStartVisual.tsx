/**
 * What the computer shows the first time WilmAI Home starts (the installers aren't signed by Apple or Microsoft
 * yet), with the button to choose marked. On Windows, Edge's download warning comes first (… → Keep, then
 * Show more → Keep anyway), numbered on through the first start. The system's own words stay in English, as most
 * people's systems show them; the note beside it says the same in the page's language.
 */
export function FirstStartVisual({ kind, title, steps }: { kind: "mac" | "windows"; title: string; steps?: { download: string; start: string } }) {
  return (
    <figure className="first-start">
      <figcaption>{title}</figcaption>
      {kind === "mac" ? (
        <div className="key-visual fs-mac" aria-hidden="true">
          <div className="kv-bar kv-app">
            <span>Privacy &amp; Security</span>
          </div>
          <div className="kv-body">
            <div className="kv-row fs-mac-row">
              <span>“WilmAI Home.app” was blocked to protect your Mac.</span>
              <span className="kv-btn kv-small kv-hit">Open Anyway</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="fs-win-steps">
          {steps ? <span className="fs-sub">{steps.download}</span> : null}
          <div className="key-visual fs-edge" aria-hidden="true">
            <div className="kv-bar kv-app">
              <span>Downloads</span>
            </div>
            <div className="kv-body">
              <div className="fs-edge-file">
                <span>
                  <b>WilmAI-Home-…-windows-x64.exe</b> isn’t commonly downloaded.
                </span>
                <span className="fs-edge-more">
                  <span className="fs-step">1</span>
                  <span className="kv-btn kv-small kv-hit">…</span>
                </span>
              </div>
              <div className="fs-edge-menu">
                <span className="kv-hit">
                  <span className="fs-step">2</span> Keep
                </span>
                <span>Report this file as safe</span>
              </div>
            </div>
          </div>
          <div className="key-visual fs-edge" aria-hidden="true">
            <div className="kv-body">
              <b className="fs-edge-title">Make sure you trust WilmAI-Home-…-windows-x64.exe before you open it</b>
              <span className="fs-edge-link">
                <span className="fs-step">3</span> Show more ⌄
              </span>
              <span className="fs-edge-link">
                <span className="fs-step">4</span> <span className="kv-hit fs-edge-keep">Keep anyway</span>
              </span>
              <div className="fs-edge-foot">
                <span className="kv-btn kv-small">Delete</span>
                <span className="kv-btn kv-small">Cancel</span>
              </div>
            </div>
          </div>
          {steps ? <span className="fs-sub">{steps.start}</span> : null}
          <div className="key-visual fs-win" aria-hidden="true">
            <div className="fs-win-body">
              <b>Windows protected your PC</b>
              <span>Microsoft Defender SmartScreen prevented an unrecognized app from starting.</span>
              <span className="fs-win-link">
                <span className="fs-step">5</span> More info
              </span>
            </div>
            <div className="fs-win-foot">
              <span className="fs-step">6</span>
              <span className="kv-btn kv-small kv-hit">Run anyway</span>
              <span className="kv-btn kv-small">Don’t run</span>
            </div>
          </div>
        </div>
      )}
    </figure>
  );
}
