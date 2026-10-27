import { useEffect, useState, useSyncExternalStore } from "react";
import { MANAGED_ENDPOINT } from "../ai/config";
import { localPackStatus, setupSnapshot, startLocalSetup, stopLocalSetup, subscribeSetup, type LocalPackStatus } from "../ai/managed";
import { useApp } from "../data/store";
import { isDesktopApp } from "../wilma/transport";
import { t } from "../i18n";

const gb = (bytes: number) => (bytes / 1e9).toFixed(1);
export function LocalAISetup() {
  const enabled = useApp((s) => s.settings.aiProvider === "local" && s.settings.localAI?.endpoint === MANAGED_ENDPOINT);
  const setup = useSyncExternalStore(subscribeSetup, setupSnapshot);
  const [status, setStatus] = useState<LocalPackStatus | null>(null);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    if (!isDesktopApp) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await localPackStatus(); if (!disposed) { setStatus(next); setError(""); } }
      catch (err) { if (!disposed) setError(String(err)); }
      if (!disposed) timer = setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);
  const remove = async () => {
    setRemoving(true); setError("");
    try { await stopLocalSetup(true); setStatus(await localPackStatus()); }
    catch (err) { setError(String(err)); }
    finally { setRemoving(false); }
  };
  const cancel = async () => {
    setRemoving(true); setError("");
    try { await stopLocalSetup(); setStatus(await localPackStatus()); }
    catch (err) { setError(String(err)); }
    finally { setRemoving(false); }
  };
  const downloading = status?.phase === "downloading" || status?.phase === "verifying";
  const pending = setup.busy || downloading;
  const ready = status?.phase === "ready";
  const enoughDisk = ready || Boolean(status && status.availableBytes >= status.requiredFreeBytes);
  const issue = error || setup.error || status?.error;
  return (
    <div className="local-ai-setup">
      <p>{t("Everything is read on this Mac: nothing goes to an AI service, and there's no API key or usage charge. Wilma itself still connects to your school as usual.")}</p>
      <p className="help-line">{t("Before you turn it on: it's a big download, 9.1 GB, and reading works the Mac hard, so it may run warm and use more battery. It's also slower than OpenAI and makes more mistakes, most often with dates and deadlines, so check those in the message itself.")}</p>
      <p className="help-line">{t("Needs an Apple Silicon Mac with at least 16 GB of memory.")}</p>
      {!isDesktopApp ? <p className="notice">{t("Local AI is set up in the Mac app.")}</p> : null}
      {status && !status.supported ? <p className="notice">{t("This computer can't run local AI. It needs an Apple Silicon Mac with 16 GB of memory.")}</p> : null}
      {status && status.supported ? <p className="help-line">{ready ? t("Models installed ({size} GB). Choosing another option keeps them; Remove models frees the space.", { size: gb(status.installedBytes) }) : t("Needs {needed} GB of free space; {free} GB is free.", { free: gb(status.availableBytes), needed: gb(status.requiredFreeBytes) })}</p> : null}
      {pending ? (
        <div className="local-ai-progress" role="status" aria-live="polite">
          <label htmlFor="local-ai-progress">{setup.checking ? t("Testing the models with sample text…") : status?.phase === "verifying" ? t("Checking the download…") : t("Downloading the models…")}</label>
          <progress id="local-ai-progress" max={status?.totalBytes || 1} value={status?.downloadedBytes || 0} />
          <span>{status ? t("{done} / {total} GB", { done: gb(status.downloadedBytes), total: gb(status.totalBytes) }) : t("Preparing…")}</span>
        </div>
      ) : null}
      <div className="local-ai-actions">
        {pending ? <button className="btn" onClick={() => void cancel()} disabled={removing}>{removing ? t("Stopping…") : t("Cancel setup")}</button> : enabled ? <span className="ai-on">{t("On. AI runs on this Mac.")}</span> : (
          <button className="btn btn-primary" onClick={() => void startLocalSetup().catch((err) => setError(String(err)))} disabled={!isDesktopApp || !status?.supported || !enoughDisk || removing}>
            {ready ? t("Turn on") : issue || (status?.downloadedBytes ?? 0) > 0 ? t("Try again") : t("Download models and turn on")}
          </button>
        )}
        {!pending && (status?.downloadedBytes ?? 0) > 0 ? <button className="btn btn-quiet" onClick={() => void remove()} disabled={removing}>{removing ? t("Removing…") : t("Remove models")}</button> : null}
      </div>
      {status && !enoughDisk ? <p className="notice err">{t("Free up some disk space first.")}</p> : null}
      {issue ? <p className="notice err" role="alert">{issue}</p> : null}
    </div>
  );
}
