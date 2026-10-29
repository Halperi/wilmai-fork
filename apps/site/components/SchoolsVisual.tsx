import type { SchoolsVisualLabels } from "../lib/home";

/**
 * The sign-in page with two schools' Wilmas, each signed in with its child ticked, then the way to add another and
 * one button into the app. Drawn in the site's sketch style (like TranslateVisual), with the app's own wording and the
 * made-up sample family. Decorative: the section's text says the same.
 */
export function SchoolsVisual({ labels }: { labels: SchoolsVisualLabels }) {
  return (
    <div className="key-visual schools-visual" aria-hidden="true">
      <div className="kv-bar">
        <span className="kv-dot" />
        <span className="kv-dot" />
        <span className="kv-dot" />
        <span className="kv-url">WilmAI Home</span>
      </div>
      <div className="kv-body">
        <span className="kv-title">{labels.title}</span>
        {labels.schools.map((school) => (
          <div className="sv-school" key={school.name}>
            <div className="kv-row">
              <span className="kv-label">{school.name}</span>
              <span className="sv-on">{labels.signedIn}</span>
            </div>
            <span className="sv-child">
              <span className="sv-check">✓</span> {school.child}
            </span>
          </div>
        ))}
        <span className="kv-btn kv-small sv-add">+ {labels.add}</span>
        <span className="kv-btn kv-hit">{labels.open}</span>
      </div>
    </div>
  );
}
