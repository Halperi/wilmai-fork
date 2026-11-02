import { appPlatform } from "../platform";
import { useEffect, useState } from "react";
import { updateSettings, useApp } from "../data/store";
import { intelligenceOn } from "../data/model";
import { notificationOptions, type NotificationOptions } from "../data/school-notifications";
import { clearSchoolNotifications, enableSchoolNotifications, notificationPermission, refreshSchoolNotifications, testSchoolNotification } from "../data/mobile-notifications";
import { t } from "../i18n";

export function SchoolNotificationSettings() {
  const settings = useApp((s) => s.settings);
  const error = useApp((s) => s.schoolNotificationError);
  const [permission, setPermission] = useState("prompt");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const options = notificationOptions(settings);
  useEffect(() => {
    const check = () => { void notificationPermission().then(setPermission).catch(() => setStatus(t("Notification settings are unavailable."))); };
    check(); document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);
  const change = (patch: Partial<NotificationOptions>) => updateSettings({ schoolNotifications: { ...options, ...patch } });
  const enable = async (enabled: boolean) => {
    setBusy(true); setStatus(null);
    try {
      if (!enabled) { updateSettings({ notify: false }); await clearSchoolNotifications(); }
      else if (await enableSchoolNotifications()) { setPermission("granted"); updateSettings({ notify: true }); await refreshSchoolNotifications(); }
      else { setPermission("denied"); setStatus(t("Allow notifications in your phone's Settings to enable alerts.")); }
    } catch { setStatus(t("Notification settings are unavailable.")); }
    finally { setBusy(false); }
  };
  const choices: ["messages" | "notes" | "grades" | "reminders", string][] = [
    ["messages", "New messages and replies"], ["notes", "New lesson notes and unexplained absences"],
    ["grades", "New and changed exam results"], ["reminders", "School deadlines tomorrow"],
  ];
  return <section className="card">
    <h2>{t("Notifications")}</h2>
    <label className="switch"><input type="checkbox" disabled={busy} checked={settings.notify !== false && permission === "granted"} onChange={(e) => void enable(e.target.checked)} />
      <div><b>{t("Notify me")}</b><span>{t("Only changes detected after notifications were enabled. Old school history does not trigger alerts.")}</span></div>
    </label>
    {choices.map(([key, label]) => <label className="switch" key={key}><input type="checkbox" checked={options[key]} onChange={(e) => change({ [key]: e.target.checked })} /><div><b>{t(label)}</b></div></label>)}
    <label className="switch"><input type="checkbox" checked={options.digest} disabled={!intelligenceOn(settings)} onChange={(e) => change({ digest: e.target.checked })} />
      <div><b>{t("Tomorrow's school summary")}</b><span>{t("School hours, exams and the AI's verified calendar readings. No additional AI request is made.")}</span></div>
    </label>
    <label>{t("Evening summary time")} <input type="time" value={options.digestTime} onChange={(e) => change({ digestTime: e.target.value })} /></label>
    {!intelligenceOn(settings) ? <p className="help-line">{t("Enable AI to use the evening summary.")}</p> : null}
    <label className="switch"><input type="checkbox" checked={options.details} onChange={(e) => change({ details: e.target.checked })} />
      <div><b>{t("Show names and school details in notifications")}</b><span>{t("These details may appear on the lock screen. Off: notifications only say that school information is available.")}</span></div>
    </label>
    <label className="switch"><input type="checkbox" checked={options.background} onChange={(e) => change({ background: e.target.checked })} />
      <div><b>{t("Allow background checks")}</b><span>{t(appPlatform === "android" ? "Android may check while the app remains in memory. Closing it or battery restrictions can stop checks. Scheduled summaries use downloaded data; open the app regularly. These are local notifications, not live push alerts." : "iOS chooses when checks run. A locked phone or battery settings can delay checks. Force-quitting stops checks until you reopen the app. These are local notifications, not live push alerts.")}</span></div>
    </label>
    <p className="help-line">{t("The evening notification uses the latest downloaded plan. Open the app regularly to keep it current; changes made while the app is closed may be missing.")}</p>
    <button className="btn btn-sm" disabled={busy} onClick={() => {
      setBusy(true); setStatus(null);
      void testSchoolNotification().then(() => setStatus(t("Test notification requested."))).catch(() => setStatus(t("Allow notifications in your phone's Settings to enable alerts."))).finally(() => setBusy(false));
    }}>{t("Send a test notification")}</button>
    {error || status ? <p role="status">{status ?? error}</p> : null}
  </section>;
}
