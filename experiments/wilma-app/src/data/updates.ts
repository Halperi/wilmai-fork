/** Edition-specific, signed updates. School data never enters this request. */
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { compare } from "semver";
import { isDesktopApp } from "../wilma/transport";
import { flushPersisted, getState, setState } from "./store";
import { appEdition, APP_VERSION } from "./edition";
import { failedCheck, type Release } from "./update-state";

const EVERY_MS = 6 * 60 * 60 * 1000;
export const compareVersions = compare;
const currentVersion = () => isDesktopApp ? getVersion() : Promise.resolve(APP_VERSION);
let pending: Update | null = null;
let installed = false;
let checking: Promise<void> | null = null;

async function latestRelease(): Promise<Release | null> {
  // Development previews only; public builds cannot manufacture an update.
  if (import.meta.env?.DEV && !isDesktopApp) {
    const fake = localStorage.getItem("wilmai.fakeUpdate");
    if (fake) return { version: fake, notes: "A development preview.", url: "https://wilm.ai/app", canInstall: false };
  }
  if (!isDesktopApp) throw new Error("Update checks require the desktop app.");
  if (!(await appEdition()).signedUpdater) return invoke<Release | null>("update_manifest");
  const found = await check({ timeout: 10_000 });
  const previous = pending;
  pending = found;
  installed = false;
  if (previous) await previous.close().catch(() => {});
  return found ? { version: found.version, notes: found.body ?? null, url: "https://wilm.ai/app", canInstall: true } : null;
}

/** Single-flight checks preserve a known update and the last successful check on failure. */
export function checkForUpdate(): Promise<void> {
  if (getState().update.phase !== "idle") return Promise.resolve();
  if (checking) return checking;
  checking = (async () => {
    try {
      const [current, latest] = await Promise.all([currentVersion(), latestRelease()]);
      const available = latest && compareVersions(latest.version, current) > 0 ? latest : null;
      setState((s) => ({ update: { ...s.update, available, current, checkedAt: Date.now(), error: null } }));
    } catch {
      setState((s) => ({ update: failedCheck(s.update) }));
    }
  })().finally(() => { checking = null; });
  return checking;
}

export async function downloadUpdate(): Promise<void> {
  if (!pending || getState().update.phase !== "idle") return;
  setState((s) => ({ update: { ...s.update, phase: "downloading", progress: null, error: null } }));
  let bytes = 0, total: number | undefined;
  try {
    await pending.download((event) => {
      if (event.event === "Started") { bytes = 0; total = event.data.contentLength; }
      if (event.event === "Progress") bytes += event.data.chunkLength;
      setState((s) => ({ update: { ...s.update, progress: total ? Math.min(100, Math.round(bytes / total * 100)) : null } }));
    }, { timeout: 120_000 });
    setState((s) => ({ update: { ...s.update, phase: "ready", progress: 100 } }));
  } catch {
    setState((s) => ({ update: { ...s.update, phase: "idle", progress: null, error: "download" } }));
  }
}

export async function installUpdate(): Promise<void> {
  if (!pending || getState().update.phase !== "ready") return;
  setState((s) => ({ update: { ...s.update, phase: "installing", error: null } }));
  try {
    // Model downloads and workers are separate from the bundle; stop them before replacing it.
    await invoke("prepare_app_update");
    await flushPersisted();
    // Windows installers may exit this process; all state is saved before install.
    if (!installed) { await pending.install(); installed = true; }
    await invoke("restart_after_update");
  } catch {
    await invoke("resume_after_failed_update").catch(() => {});
    setState((s) => ({ update: { ...s.update, phase: "ready", error: "install" } }));
  }
}

let started = false;
export function startUpdateChecks(): void {
  if (started) return;
  started = true;
  void currentVersion().then((current) => setState((s) => ({ update: { ...s.update, current } }))).catch(() => {});
  const maybe = () => { if (getState().settings.updateChecks) void checkForUpdate(); };
  setTimeout(maybe, 15_000);
  setInterval(maybe, EVERY_MS);
  if (isDesktopApp) void listen("wilmai:update", () => { void checkForUpdate().then(() => { if (getState().phase !== "signed-out") window.location.hash = "#/settings"; }); }).catch(() => {});
}
