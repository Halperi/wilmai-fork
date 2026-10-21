/**
 * What the computer shows the first time WilmAI Home starts (the installers aren't signed by Apple or Microsoft
 * yet), with the button to choose marked. The system's own words stay in English, as most people's systems show
 * them; the note beside it says the same in the page's language.
 */
export function FirstStartVisual({ kind, title }: { kind: "mac" | "windows"; title: string }) {
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
        <div className="key-visual fs-win" aria-hidden="true">
          <div className="fs-win-body">
            <b>Windows protected your PC</b>
            <span>Microsoft Defender SmartScreen prevented an unrecognized app from starting.</span>
            <span className="fs-win-link">
              <span className="fs-step">1</span> More info
            </span>
          </div>
          <div className="fs-win-foot">
            <span className="fs-step">2</span>
            <span className="kv-btn kv-small kv-hit">Run anyway</span>
            <span className="kv-btn kv-small">Don’t run</span>
          </div>
        </div>
      )}
    </figure>
  );
}
