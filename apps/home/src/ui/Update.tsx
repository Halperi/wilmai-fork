/** Update access remains available before sign-in and through the menu bar. */
import { useEffect, useRef, useState } from "react";
import { updateSettings, useApp } from "../data/store";
import { checkForUpdate, downloadUpdate, installUpdate } from "../data/updates";
import { APP_VERSION } from "../data/edition";
import { t } from "../i18n";
import { go } from "./shared";

export function UpdateDot() {
  const update = useApp((s) => s.update);
  const [open, setOpen] = useState(false);
  if (!update.available) return null;
  return (
    <>
      <button
        type="button"
        className="update-dot"
        onClick={() => setOpen(true)}
        title={t("Version {version} is available", { version: update.available.version })}
        aria-label={t("Version {version} is available", { version: update.available.version })}
      >
        <span />
      </button>
      {open ? <UpdateDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function UpdateDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const update = useApp((s) => s.update);
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  const release = update.available;
  if (!release) return null;
  return (
    <dialog ref={ref} className="lesson-dialog" onClose={onClose} onCancel={(e) => { if (update.phase === "installing") e.preventDefault(); }} onClick={(e) => e.target === ref.current && update.phase !== "installing" && onClose()} aria-labelledby="update-title">
      <div className="lesson-card">
        <h2 id="update-title">{t("WilmAI Home {version} is available", { version: release.version })}</h2>
        <p className="lesson-sub">{t("You have version {current}.", { current: update.current ?? "?" })}</p>
        {release.notes ? <p className="update-notes">{release.notes}</p> : null}
        {update.error && update.error !== "check" ? <p className="notice err" role="alert">{t("The update didn't finish. The version you have still works; try again later.")}</p> : null}
        {update.phase === "downloading" ? <p role="status">{t("Downloading the update…")} <progress max={100} value={update.progress ?? undefined} /> {update.progress === null ? "" : `${update.progress}%`}</p> : null}
        {update.phase === "ready" ? <p>{t("The update is downloaded. The app restarts to install it.")}</p> : null}
        {update.phase === "installing" ? <p role="status">{t("Installing and restarting…")}</p> : null}
        <div className="lesson-actions" style={{ gap: 8 }}>
          <button className="btn" onClick={onClose} disabled={update.phase === "installing"}>
            {t("Later")}
          </button>
          {release.canInstall ? <button className="btn btn-primary" disabled={update.phase === "downloading" || update.phase === "installing"} onClick={() => void (update.phase === "ready" ? installUpdate() : downloadUpdate())}>
            {update.phase === "ready" ? t("Install and restart") : t("Download update")}
          </button> : release.url ? (
            <a className="btn btn-primary" href={release.url} target="_blank" rel="noreferrer" onClick={onClose}>
              {t("Get the new version")}
            </a>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}

/** The menu's corner: this version, and whether it's the newest; it opens the Updates card in Settings. */
export function VersionLine() {
  const update = useApp((s) => s.update);
  const state = update.available ? t("Update available") : update.checkedAt && !update.error ? t("Up to date") : null;
  return (
    <button
      type="button"
      className={`nav-version${update.available ? " has-update" : ""}`}
      onClick={() => {
        go("settings");
        setTimeout(() => document.getElementById("updates")?.scrollIntoView({ block: "start" }), 50);
      }}
    >
      WilmAI Home {update.current ?? APP_VERSION}
      {state ? <span> · {state}</span> : null}
    </button>
  );
}

/** Settings: the version, automatic checks on or off, and checking now. */
export function UpdatesCard({ compact = false }: { compact?: boolean }) {
  const update = useApp((s) => s.update);
  const on = useApp((s) => s.settings.updateChecks);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const check = async () => {
    setChecking(true);
    await checkForUpdate();
    setChecking(false);
  };
  return (
    <section className={compact ? "updates-compact" : "card"} id={compact ? undefined : "updates"}>
      {compact ? <p className="help-line">WilmAI Home {update.current ?? APP_VERSION} Beta</p> : <h2>{t("Updates")}</h2>}
      {!compact ? <label className="switch">
        <input type="checkbox" checked={on} onChange={(e) => updateSettings({ updateChecks: e.target.checked })} />
        <div>
          <b>{t("Look for new versions")}</b>
          <span>{t("A few times a day the app asks wilm.ai whether there's a newer version. It sends nothing about you; the site sees this computer's address and the app's version.")}</span>
        </div>
      </label> : null}
      <p className="help-line">
        {update.error === "check"
          ? t("Couldn't check for updates. Try again when you're online.")
          : update.available
          ? t("Version {version} is available (you have {current}).", { version: update.available.version, current: update.current ?? "?" })
          : update.checkedAt
            ? t("You have the newest version ({current}).", { current: update.current ?? "?" })
            : t("You have version {current}.", { current: update.current ?? "?" })}{" "}
        <button className="linkish" onClick={() => void check()} disabled={checking}>
          {checking ? t("Checking…") : t("Check now")}
        </button>
      </p>
      {update.available ? <button className="btn btn-primary" onClick={() => setOpen(true)}>{t("View update {version}", { version: update.available.version })}</button> : null}
      {open ? <UpdateDialog onClose={() => setOpen(false)} /> : null}
    </section>
  );
}
