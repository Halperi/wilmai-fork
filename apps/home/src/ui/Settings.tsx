import { useMemo, useState, type ReactNode } from "react";
import { setViewAs, updateSettings, useApp, useViewer } from "../data/store";
import { buildFeed } from "../data/feed";
import { UpdatesCard } from "./Update";
import { APP_VERSION } from "../data/edition";
import { SessionHistory } from "./SessionHistory";
import { isDemo, leaveDemo, resetApp, signInDemo, signOut, syncNow } from "../data/engine";
import { go } from "./shared";
import { AISettings } from "./AISettings";
import { notificationsAvailable, testNotification } from "../data/notify";
import { Icon } from "./bits";
import { isDesktopApp, onWindows } from "../wilma/transport";
import { plural, resolveLanguage, t, tx } from "../i18n";
import type { Settings as SettingsModel, Viewer } from "../data/model";
import { DEFAULT_TRANSLATOR, TRANSLATION_LANGUAGES, TRANSLATORS, itemsPerMonth, translationAvailable } from "../ai/translate";
import { runJev } from "../jev/runner";
import { runLuna } from "../luna/events";
import { READING_MODELS } from "../luna/client";

/** A sentence translated whole, with the part between asterisks wrapped in markup. */
function marked(text: string, wrap: (part: string) => ReactNode): ReactNode {
  const [before, part, after = ""] = text.split("*");
  return part === undefined ? text : (
    <>
      {before}
      {wrap(part)}
      {after}
    </>
  );
}

/** A fraction of a cent, in dollars as OpenAI bills them: "$0.0001", "$0.005". */
const dollars = (n: number) => `$${n.toFixed(Math.max(2, -Math.floor(Math.log10(n))))}`;

/** With OpenAI: the language the Translate button translates into, or none, and which model translates (ai/translate.ts). */
function TranslationSettings({ settings }: { settings: SettingsModel }) {
  const chosen = settings.translateTo ?? resolveLanguage(settings.language);
  const translator = settings.translateModel ?? DEFAULT_TRANSLATOR;
  // What a month would cost, from what this family gets: everything translated, so at most that.
  const snapshot = useApp((s) => s.snapshot);
  const local = useApp((s) => s.local);
  const monthly = useMemo(() => Math.round(itemsPerMonth(buildFeed({ snapshot, local, jev: {}, luna: {} }))), [snapshot, local]);
  return (
    <section className="card">
      <h2>
        <Icon name="translate" /> {t("Translating messages")}
      </h2>
      <p>{t("Messages, bulletins and notes in another language get a Translate button. Choose the language to translate into.")}</p>
      <div role="group" aria-label={t("Translate into")} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="seg" aria-pressed={chosen === "off"} onClick={() => updateSettings({ translateTo: "off" })}>
          {t("No translations")}
        </button>
        {Object.entries(TRANSLATION_LANGUAGES).map(([id, name]) => (
          <button key={id} className="seg" lang={id} aria-pressed={chosen === id} onClick={() => updateSettings({ translateTo: id as keyof typeof TRANSLATION_LANGUAGES })}>
            {name}
          </button>
        ))}
      </div>
      {chosen !== "off" ? (
        <fieldset className="translator">
          <legend>{t("Translator")}</legend>
          {TRANSLATORS.map((x) => (
            <label key={x.model} className="switch">
              <input type="radio" name="translator" checked={translator === x.model} onChange={() => updateSettings({ translateModel: x.model })} />
              <div>
                <b>
                  {t(x.label)}
                  {x.model === DEFAULT_TRANSLATOR ? <span className="translator-badge">{t("Recommended")}</span> : null}
                </b>
                <span className="translator-cost">
                  {monthly
                    ? t("About {cost} a message, at most {month} a month.", { cost: dollars(x.perMessage), month: dollars(Math.max(x.perMessage, monthly * x.perMessage)) })
                    : t("About {cost} a message.", { cost: dollars(x.perMessage) })}
                </span>
                <span>
                  {t(x.help)} {READING_MODELS[x.model].label}.
                </span>
              </div>
            </label>
          ))}
          <p className="help-line">
            {monthly ? `${plural(monthly, "About {n} message, bulletin or note comes in a month: \"at most\" is all of them translated.", "About {n} messages, bulletins and notes come in a month: \"at most\" is all of them translated.")} ` : ""}
            {t("Paid from your OpenAI key, within your monthly limit. A translation is kept, so each message is paid for once.")}
          </p>
        </fieldset>
      ) : null}
    </section>
  );
}

const LANGUAGES: { id: SettingsModel["language"]; label: () => string }[] = [
  { id: "auto", label: () => t("Automatic") },
  { id: "fi", label: () => "Suomi" },
  { id: "en", label: () => "English" },
];

export function Settings() {
  const settings = useApp((s) => s.settings);
  const snap = useApp((s) => s.snapshot)!;
  const demo = isDemo();
  const student = useViewer() === "student";

  return (
    <main className="page settings">
      <h1>{t("Settings")}</h1>

      <AISettings />

      {translationAvailable(settings) ? <TranslationSettings settings={settings} /> : null}

      {!demo ? <WhoFor /> : null}

      <section className="card">
        <h2>{t("Language")}</h2>
        <p>{t("Automatic follows your computer's language.")}</p>
        <div role="group" aria-label={t("Language")} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              className="seg"
              lang={l.id === "auto" ? undefined : l.id}
              aria-pressed={(settings.language ?? "auto") === l.id}
              onClick={() => updateSettings({ language: l.id })}
            >
              {l.label()}
            </button>
          ))}
        </div>
      </section>

      {notificationsAvailable ? (
        <section className="card">
          <h2>
            <Icon name="bell" /> {t("Notifications")}
          </h2>
          <label className="switch">
            <input type="checkbox" checked={settings.notify !== false} onChange={(e) => updateSettings({ notify: e.target.checked })} />
            <div>
              <b>{t("Notify me")}</b>
              <span>{t("When something new needs you, and the evening before its deadline. Clicking a notification opens it.")}</span>
            </div>
          </label>
          <p className="help-line">
            {onWindows
              ? t("WilmAI Home stays by the clock, in the taskbar's notification area, when you close its window, and checks Wilma every ten minutes. Quit it by right-clicking that icon.")
              : t("WilmAI Home stays in the menu bar when you close its window and checks Wilma every ten minutes. Quit it from the menu bar icon.")}
          </p>
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => void testNotification()}>
            {t("Send a test notification")}
          </button>
        </section>
      ) : null}

      <section className="card">
        <h2>
          <Icon name="lock" /> {t("Where your information is")}
        </h2>
        <ul className="facts">
          <li>
            <Icon name="device" />
            <span>
              <b>{isDesktopApp ? t("On this computer.") : t("In this browser.")}</b>{" "}
              {t("Messages, timetables and the AI's answers are stored here so the app opens instantly. No WilmAI server is involved.")}
            </span>
          </li>
          <li>
            <Icon name="lock" />
            <span>
              {snap.account.via === "password" && settings.wilmaPassword ? (
                <>
                  <b>{t("Your Wilma password is remembered on this computer, scrambled,")}</b> {t("so signing in again is one click.")}{" "}
                  <button type="button" className="linkish" onClick={() => updateSettings({ rememberPassword: false, staySignedIn: false, wilmaPassword: "" })}>
                    {t("Forget it")}
                  </button>
                </>
              ) : (
                <>
                  <b>{t("Your Wilma password isn't kept.")}</b>{" "}
                  {t("Only the session Wilma gives after you sign in is, the same way a browser keeps it on Wilma's own site.")}
                </>
              )}
            </span>
          </li>
          <li>
            <Icon name="spark" />
            <span>
              {marked(
                student
                  ? t("*OpenAI sees one item at a time,* with your first name and class, when you choose OpenAI. Local AI reads everything on this Mac, and No AI reads nothing.")
                  : t("*OpenAI sees one item at a time,* with your children's first names and classes, when you choose OpenAI. Local AI reads everything on this Mac, and No AI reads nothing."),
                (part) => <b>{part}</b>
              )}
            </span>
          </li>
        </ul>
      </section>

      {!demo ? (
        <section className="card">
          <h2>{t("Reading from Wilma")}</h2>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.backgroundRead}
              onChange={(e) => {
                updateSettings({ backgroundRead: e.target.checked });
                if (e.target.checked) void syncNow();
              }}
            />
            <div>
              <b>{t("Open new messages in the background")}</b>
              <span>
                {t("Lets the AI read the whole message before you do. Wilma then shows those messages as read. Off: unread messages are sorted from their subject until you open them.")}
              </span>
            </div>
          </label>
          <StaySignedIn />
          <p style={{ marginTop: 10 }}>
            {tx(snap.account.via === "cli" ? "Signed in to {school} with the WilmAI CLI's saved login." : "Signed in to {school}.", {
              school: <b>{snap.account.tenantName ?? new URL(snap.account.baseUrl).host}</b>,
            })}
          </p>
        </section>
      ) : null}

      {!demo ? <SessionHistory /> : null}

      <section className="card">
        <h2>{t("Sample family")}</h2>
        {demo ? (
          <>
            <p>{t("You're looking at a made-up family. Leaving takes you back to sign-in; your OpenAI key stays.")}</p>
            <button className="btn" onClick={() => { go("today"); void leaveDemo(); }}>
              {t("Leave the sample family")}
            </button>
          </>
        ) : (
          <>
            <p>{t("See the app with a made-up family. Your own messages and AI answers stay saved for when you sign back in.")}</p>
            <button className="btn" onClick={() => { go("today"); void signInDemo(); }}>
              {t("Show the sample family")}
            </button>
          </>
        )}
      </section>

      {!demo ? <section className="card">
        <h2>{t("Sign out")}</h2>
        <p>{t("Return to the start screen to sign in with another Wilma account. Your OpenAI key, settings, messages, drafts and AI answers stay saved on this computer, separately for each account.")}</p>
        <button className="btn" onClick={() => { go("today"); void signOut(); }}>
          {t("Sign out")}
        </button>
      </section> : null}

      <UpdatesCard />

      <p className="build-stamp">WilmAI Home {APP_VERSION} Beta · {__APP_BUILD__}</p>

      <ResetApp />
    </main>
  );
}

/**
 * Who the app is for on this account: a parent, or the student in their own Wilma. Wilma's role for the login decides
 * until it's chosen here. A student sees their own steps first, without a guardian's (sign-ups, absence reports).
 */
function WhoFor() {
  const viewer = useViewer();
  const wilmaRole = useApp((s) => s.snapshot?.account.wilmaRole);
  const choose = (who: Viewer) => {
    if (who === viewer) return;
    setViewAs(who === wilmaRole ? null : who);
    // The AI reads for whoever reads the app: its answers for the other one aren't used.
    void runJev();
    void runLuna();
  };
  return (
    <section className="card">
      <h2>{t("Who uses this account")}</h2>
      <div role="group" aria-label={t("Who uses this account")} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(["guardian", "student"] as const).map((who) => (
          <button key={who} className="seg" aria-pressed={viewer === who} onClick={() => choose(who)}>
            {who === "guardian" ? t("A parent") : t("A student")}
          </button>
        ))}
      </div>
      <p className="help-line">
        {wilmaRole === "student" ? t("Wilma says this is a student's own login.") : wilmaRole === "guardian" ? t("Wilma says this is a guardian's login.") : null}{" "}
        {t("A student sees their own steps first: what to do, bring and hand in. A guardian's steps, such as sign-ups and absence reports, are left out. Changing this has the AI read the messages again.")}
      </p>
    </section>
  );
}

function ResetApp() {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card settings-reset">
      <h2>{t("Reset app and delete all data")}</h2>
      <p>{t("Signs out of Wilma and permanently deletes all accounts' messages, AI answers, drafts, settings, usage history and API keys saved by this app on this computer.")}</p>
      {asking ? <div className="settings-reset-confirm">
        <p>{t("This can't be undone. Afterwards you sign in and choose your AI from the start, and your messages are read again.")}</p>
        <button className="btn btn-danger" disabled={busy} onClick={async () => {
          setBusy(true);
          setError(null);
          try { await resetApp(); go("today"); }
          catch (err) { setError(err instanceof Error ? err.message : String(err)); setBusy(false); }
        }}>{busy ? t("Resetting…") : t("Delete all data and reset")}</button>
        <button className="btn" disabled={busy} onClick={() => setAsking(false)}>{t("Cancel")}</button>
      </div> : <button className="btn btn-danger" onClick={() => setAsking(true)}>{t("Reset app…")}</button>}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

/**
 * Stay signed in: Wilma ends the app's session whenever Wilma is signed in elsewhere, and the app then signs in
 * again by itself (engine's getBack), so notifications keep coming. With the CLI's saved login nothing more is
 * needed; signed in with a password, the app keeps it (scrambled) while this is on.
 */
function StaySignedIn() {
  const settings = useApp((s) => s.settings);
  const via = useApp((s) => s.snapshot?.account.via);
  const username = useApp((s) => s.snapshot?.account.username);
  const rejoin = useApp((s) => s.rejoin);
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const needsPassword = via === "password" && !settings.wilmaPassword;
  const turn = (on: boolean) => {
    if (on && needsPassword) return setAsking(true);
    setAsking(false);
    // Off: a remembered password stays for one-click sign-in.
    updateSettings(on ? { staySignedIn: true } : { staySignedIn: false, ...(settings.rememberPassword === false ? { wilmaPassword: "" } : {}) });
  };
  return (
    <>
      <label className="switch">
        <input type="checkbox" checked={Boolean(settings.staySignedIn) || asking} onChange={(e) => turn(e.target.checked)} />
        <div>
          <b>{t("Stay signed in")}</b>
          <span>
            {t("When Wilma signs the app out, it signs in again by itself, so notifications keep coming.")}{" "}
            {t("Signing in ends your other Wilma sessions, such as Wilma open in a browser. If Wilma keeps signing the app out, it waits half an hour or more before trying again, so it doesn't race you.")}
          </span>
        </div>
      </label>
      {asking ? (
        <div className="field stay-password">
          <label htmlFor="stay-password">{t("Your Wilma password ({username})", { username: username ?? "" })}</label>
          <div className="ai-key">
            <input id="stay-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button
              className="btn btn-primary"
              disabled={!password}
              onClick={() => {
                updateSettings({ staySignedIn: true, wilmaPassword: password });
                setPassword("");
                setAsking(false);
              }}
            >
              {t("Turn on")}
            </button>
            <button className="btn btn-quiet" onClick={() => setAsking(false)}>
              {t("Cancel")}
            </button>
          </div>
          <span className="help">{t("Kept on this computer, scrambled but not encrypted, only while Stay signed in is on.")}</span>
        </div>
      ) : null}
      {settings.staySignedIn && via === "cli" ? <p className="help-line">{t("It signs in with the WilmAI CLI's saved login on this computer.")}</p> : null}
      {settings.staySignedIn && rejoin.failed ? <div className="notice err">{t("Signing in again didn't work: {why} Sign in once yourself to start again.", { why: rejoin.failed })}</div> : null}
    </>
  );
}
