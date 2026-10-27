import type { TranslateVisualLabels } from "../lib/home";

/**
 * A message as WilmAI Home shows it translated: the language picked in Settings, then the reader with its note on who
 * translated it from what. Drawn in the site's sketch style (like KeyVisual), with the app's own wording. Decorative:
 * the section's text says the same.
 */
export function TranslateVisual({ labels }: { labels: TranslateVisualLabels }) {
  return (
    <div className="key-visual translate-visual" aria-hidden="true">
      <div className="kv-bar">
        <span className="kv-dot" />
        <span className="kv-dot" />
        <span className="kv-dot" />
        <span className="kv-url">WilmAI Home</span>
      </div>
      <div className="kv-body">
        <div className="kv-chips tv-languages">
          {labels.languages.map((name) => (
            <span className={`kv-chip${name === labels.chosen ? " kv-hit" : ""}`} key={name}>
              {name}
            </span>
          ))}
        </div>
        <div className="tv-message">
          <span className="tv-title">{labels.title}</span>
          <span className="tv-from">{labels.from}</span>
          <span className="tv-note">
            {labels.note} <u>{labels.showOriginal}</u>
          </span>
          <p className="tv-text">{labels.text}</p>
        </div>
      </div>
    </div>
  );
}
