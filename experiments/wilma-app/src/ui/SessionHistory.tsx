/*
 * Settings' sign-in history: when this app's Wilma session started, which
 * program's session it continued, and what ended it (see data/history.ts).
 */
import { useSessionHistory, type Program, type SessionHistoryEntry } from "../data/history";
import { clock, dateOf, relativeDay, today } from "../data/dates";
import { Icon } from "./bits";
import { t } from "../i18n";

/** The program that saved a session, as a sentence part. */
function programName(by: Program): string {
  switch (by) {
    case "home":
      return t("WilmAI Home");
    case "cli":
      return t("the WilmAI CLI");
    case "mcp":
      return t("an assistant's WilmAI connector");
    default:
      return t("another WilmAI program");
  }
}

/** "16:23" today, "Yesterday 16:23", "Mon 5 Oct 16:23". */
function stamp(ms: number): string {
  const instant = new Date(ms);
  const iso = dateOf(instant);
  return iso === today() ? clock(instant) : `${relativeDay(iso)} ${clock(instant)}`;
}

function describe(entry: SessionHistoryEntry): { icon: string; text: string; detail?: string; tone?: "warn" } {
  switch (entry.kind) {
    case "signed-in":
      return {
        icon: "lock",
        text:
          entry.how === "automatic"
            ? t("Signed in again by itself (Stay signed in)")
            : entry.how === "password"
              ? t("Signed in with your password")
              : t("Signed in with the WilmAI CLI's saved login"),
        detail: t("A new Wilma session. Wilma ends the account's other sessions, also on the phone."),
      };
    case "continued": {
      const values = { program: programName(entry.by), time: entry.savedAt ? stamp(entry.savedAt) : "?" };
      return {
        icon: "refresh",
        text: entry.midway ? t("Continued the session {program} started ({time})", values) : t("Opened with the session {program} started ({time})", values),
        detail: entry.midway ? t("Its login had ended this app's session; no new login was needed.") : t("No new login, so nothing else was signed out."),
      };
    }
    case "ended":
      return {
        icon: "flag",
        tone: "warn",
        text: entry.other
          ? t("Wilma ended the session when {program} signed in ({time})", { program: programName(entry.by), time: entry.savedAt ? stamp(entry.savedAt) : "?" })
          : t("Wilma ended the session"),
        detail: [
          entry.other ? null : t("No WilmAI program signed in after this app, so it was Wilma on a phone or in a browser, or Wilma's own time limit."),
          entry.lastOk ? t("Last reached Wilma at {time}.", { time: stamp(entry.lastOk) }) : null,
        ]
          .filter(Boolean)
          .join(" "),
      };
  }
}

export function SessionHistory() {
  const entries = useSessionHistory();
  return (
    <section className="card">
      <h2>{t("Sign-in history")}</h2>
      <p>{t("Wilma keeps one session per account: signing in anywhere (the phone, a browser, a WilmAI program) ends the others. This shows what happened to this app's session.")}</p>
      {entries.length ? (
        <ol className="session-history">
          {entries.map((entry, i) => {
            const { icon, text, detail, tone } = describe(entry);
            return (
              <li key={`${entry.at}-${entry.kind}-${i}`} className={tone === "warn" ? "warn" : undefined}>
                <Icon name={icon} />
                <div>
                  <b>{text}</b>
                  {detail ? <span>{detail}</span> : null}
                </div>
                <time dateTime={new Date(entry.at).toISOString()}>{stamp(entry.at)}</time>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted">{t("Nothing yet. Sign-ins and ended sessions show here from now on.")}</p>
      )}
    </section>
  );
}
