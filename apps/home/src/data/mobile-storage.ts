import { addPluginListener, invoke, type PluginListener } from "@tauri-apps/api/core";
import { appPlatform, isMobileApp } from "../platform";
import { flushPersisted, getState, loadSecrets, subscribe } from "./store";
import { StorageRecovery } from "./storage-recovery";

export const STORAGE_RECOVERED = "wilmai-storage-recovered";
let recovering: Promise<void> | null = null;
/** Retry startup only if it never finished. Runtime recovery preserves the engine's live sessions. */
export function retryMobileStorage(): Promise<void> {
  recovering ??= (async () => {
    await loadSecrets();
    await flushPersisted();
    if (getState().phase === "loading") window.location.reload();
    else window.dispatchEvent(new Event(STORAGE_RECOVERED));
  })().finally(() => { recovering = null; });
  return recovering;
}

export function startMobileStorageRecovery(): () => void {
  if (!isMobileApp) return () => {};
  let stopped = false;
  const blocked = () => !getState().secureStorage.ready && Boolean(getState().secureStorage.error);
  const recovery = new StorageRecovery({
    eligible: () => !stopped && document.visibilityState === "visible" && blocked() && getState().secureStorage.retryable !== false,
    available: async () => {
      if (appPlatform !== "ios") return true;
      const status = await invoke<{ protectedDataAvailable: boolean; active: boolean }>("plugin:background-refresh|privacy_status");
      return status.protectedDataAvailable === true && status.active === true;
    },
    recover: retryMobileStorage,
    later: (callback, ms) => setTimeout(callback, ms),
    cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
  let wasBlocked = false;
  const changed = () => {
    const next = blocked(), began = next && !wasBlocked;
    wasBlocked = next;
    if (began) recovery.wake();
    else if (!next) recovery.pause();
  };
  const stop = subscribe(changed);
  const returned = () => { if (document.visibilityState === "visible") recovery.wake(); else recovery.pause(); };
  document.addEventListener("visibilitychange", returned);
  window.addEventListener("focus", returned);
  let native: Promise<PluginListener> | undefined;
  if (appPlatform === "ios") native = addPluginListener("background-refresh", "storageAvailable", () => recovery.wake());
  void native?.catch(() => {}); // Timed foreground recovery also works if a native event is missed.
  changed();
  return () => {
    stopped = true; recovery.dispose(); stop();
    document.removeEventListener("visibilitychange", returned);
    window.removeEventListener("focus", returned);
    void native?.then((listener) => listener.unregister()).catch(() => {});
  };
}
