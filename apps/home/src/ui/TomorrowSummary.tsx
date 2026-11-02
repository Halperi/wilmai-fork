import { useApp } from "../data/store";
import { intelligenceOn } from "../data/model";
import { addDays, today, shortDate } from "../data/dates";
import { tomorrowDigest } from "../data/school-notifications";
import { t } from "../i18n";

export function TomorrowSummary() {
  const state = useApp((s) => s);
  if (!intelligenceOn(state.settings)) return null;
  const digest = tomorrowDigest(state, addDays(today(), 1));
  if (!digest) return null;
  return <section className="card" aria-labelledby="tomorrow-summary-heading">
    <h2 id="tomorrow-summary-heading">{t("Tomorrow's school day")} · {shortDate(digest.day)}</h2>
    {digest.lines.length ? <ul>{digest.lines.map((line) => <li key={line}>{line}</li>)}</ul> : <p>{t("No downloaded school plan for tomorrow yet.")}</p>}
    <p className="help-line">{t("Based on the latest downloaded information.")}{digest.updatedAt ? ` ${t("Updated {time}", { time: new Date(digest.updatedAt).toLocaleString() })}` : ""}</p>
  </section>;
}
