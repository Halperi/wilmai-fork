/** User-initiated setup survives navigating away from Settings. */
import { invoke } from "@tauri-apps/api/core";
import { accountScope, getState, updateSettings } from "../data/store";
import { MANAGED_ENDPOINT, LOCAL_DECIDER, LOCAL_READER } from "./config";
import { checkOllama, probeOllama, releaseLocalModels, rememberLocalProbe } from "./ollama";
import { runLuna } from "../luna/events";
import { isDesktopApp } from "../wilma/transport";

export interface LocalPackStatus {
  bundled: boolean;
  supported: boolean;
  phase: "not-installed" | "downloading" | "verifying" | "ready" | "error";
  downloadedBytes: number; totalBytes: number; installedBytes: number;
  availableBytes: number; requiredFreeBytes: number; ramBytes: number;
  file: string | null; error: string | null; runtime: string;
}
export const localPackStatus = () => invoke<LocalPackStatus>("local_ai_status");
let generation = 0;
let cleanup: Promise<void> = Promise.resolve();
let snapshot = { busy: false, checking: false, error: "" };
const listeners = new Set<() => void>();
const publish = (next: typeof snapshot) => { snapshot = next; listeners.forEach((fn) => fn()); };
export const setupSnapshot = () => snapshot;
export const subscribeSetup = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function startLocalSetup(): Promise<void> {
  if (!isDesktopApp) throw new Error("Local model setup is available in the Mac app.");
  if (snapshot.busy) return;
  const token = ++generation, scope = accountScope();
  updateSettings({ aiProvider: "off", localAI: { endpoint: MANAGED_ENDPOINT, decisionModel: LOCAL_DECIDER, readingModel: LOCAL_READER, think: true, setupPending: true } });
  const current = () => generation === token && accountScope() === scope && getState().settings.localAI?.setupPending === true;
  publish({ busy: true, checking: false, error: "" });
  try {
    await cleanup;
    if (!current()) return;
    await invoke("local_ai_install");
    while (current()) {
      const status = await localPackStatus();
      if (status.phase === "ready") break;
      if (status.phase === "error") throw new Error(status.error ?? "Local model download failed.");
      if (status.phase === "not-installed") throw new Error("Local model setup stopped. Retry to continue.");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!current()) return;
    publish({ busy: true, checking: true, error: "" });
    const settings = getState().settings;
    const status = await checkOllama(settings);
    await probeOllama(settings, current);
    if (!current()) return;
    updateSettings({ aiProvider: "local", localAI: { ...settings.localAI, fingerprint: status.fingerprint, setupPending: false } });
    rememberLocalProbe(settings, status);
    if (generation === token && accountScope() === scope && getState().settings.aiProvider === "local") void runLuna();
  } catch (error) {
    if (current()) {
      updateSettings({ localAI: { ...getState().settings.localAI, setupPending: false } });
      publish({ busy: false, checking: false, error: errorText(error) });
    }
  } finally {
    if (generation === token) publish({ ...snapshot, busy: false, checking: false });
  }
}

/** Stop immediately; clear queued work before another setup can start. */
export function stopLocalSetup(remove = false): Promise<void> {
  ++generation;
  updateSettings({ localAI: { ...getState().settings.localAI, setupPending: false }, ...(getState().settings.aiProvider === "local" ? { aiProvider: "off" as const } : {}) });
  publish({ busy: false, checking: false, error: "" });
  if (!isDesktopApp) return Promise.resolve();
  // Dispatch stop now to interrupt active inference; management commands are
  // ordered so a late removal cannot delete a newly requested installation.
  const stop = invoke("local_ai_stop");
  cleanup = cleanup.catch(() => undefined).then(async () => {
    await stop;
    await invoke(remove ? "local_ai_remove" : "local_ai_cancel");
    await releaseLocalModels();
  });
  return cleanup;
}
