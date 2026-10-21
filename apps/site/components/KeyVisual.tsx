import type { KeyVisualLabels } from "../lib/home";

/**
 * A small sketch beside each step of getting an OpenAI API key: what to look for on the page, drawn in the site's
 * own style rather than copied from OpenAI's (their pages change, and this isn't their site). OpenAI's own labels
 * stay in English, as OpenAI shows them. Decorative: the step's text says the same.
 */
export function KeyVisual({ kind, labels }: { kind: "signin" | "credit" | "key" | "app"; labels: KeyVisualLabels }) {
  const bar = (address: string) => (
    <div className="kv-bar">
      <span className="kv-dot" />
      <span className="kv-dot" />
      <span className="kv-dot" />
      <span className="kv-url">{address}</span>
    </div>
  );
  return (
    <div className="key-visual" aria-hidden="true">
      {kind === "signin" ? (
        <>
          {bar("platform.openai.com")}
          <div className="kv-body kv-center">
            <span className="kv-title">OpenAI Platform</span>
            <span className="kv-btn kv-hit">Log in</span>
            <span className="kv-btn">Sign up</span>
          </div>
        </>
      ) : kind === "credit" ? (
        <>
          {bar("platform.openai.com/account/billing")}
          <div className="kv-body">
            <span className="kv-label">Add to credit balance</span>
            <div className="kv-chips">
              <span className="kv-chip kv-hit">$5</span>
              <span className="kv-chip">$10</span>
              <span className="kv-chip">$20</span>
            </div>
            <div className="kv-row">
              <span>Auto-reload</span>
              <span className="kv-toggle" />
            </div>
            <span className="kv-note">{labels.reloadOff}</span>
          </div>
        </>
      ) : kind === "key" ? (
        <>
          {bar("platform.openai.com/api-keys")}
          <div className="kv-body">
            <span className="kv-btn kv-hit">+ Create new secret key</span>
            <div className="kv-chips kv-perms">
              <span className="kv-chip kv-on">All</span>
              <span className="kv-chip">Restricted</span>
              <span className="kv-chip">Read only</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">sk-proj-••••••••••</span>
              <span className="kv-btn kv-small">Copy</span>
            </div>
            <span className="kv-note">{labels.once}</span>
          </div>
        </>
      ) : (
        <>
          <div className="kv-bar kv-app">
            <img src="/wilmai-mascot.png" alt="" width={16} height={16} />
            <span>{labels.window}</span>
          </div>
          <div className="kv-body">
            <div className="kv-tiles">
              <span className="kv-tile">{labels.off}</span>
              <span className="kv-tile kv-on">OpenAI</span>
              <span className="kv-tile">{labels.local}</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">sk-proj-••••••</span>
              <span className="kv-btn kv-small kv-hit">{labels.turnOn}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
