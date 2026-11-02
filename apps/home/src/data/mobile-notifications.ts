import { addPluginListener, invoke, type PluginListener } from "@tauri-apps/api/core";
import { cancelAll, onAction, pending, removeAllActive, requestPermission, Schedule } from "@tauri-apps/plugin-notification";
import { appPlatform, isMobileApp } from "../platform";
import { accountScope, flushPersisted, getState, setState, subscribe } from "./store";
import { notificationOptions, privateNotice, scheduledSchoolNotices, schoolNotices, type SchoolNotice } from "./school-notifications";
import { t } from "../i18n";

export async function notificationPermission(): Promise<string> {
  const result = await invoke<{ permissionState: string }>("plugin:notification|check_permissions");
  return result.permissionState;
}
export async function enableSchoolNotifications(): Promise<boolean> { return await requestPermission() === "granted"; }
function nextId(): number {
  const value = Number(localStorage.getItem("wilmai.schoolNotificationSequence") ?? "0");
  if (!Number.isSafeInteger(value) || value < 0 || value >= 2_000_000_000) throw new Error("Invalid notification sequence");
  localStorage.setItem("wilmai.schoolNotificationSequence", String(value + 1));
  return value + 1;
}
function scopeToken(): string {
  const token = getState().local.schoolNotificationToken;
  if (token && /^[a-f0-9]{32}$/.test(token)) return token;
  const next = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  setState((s) => ({ local: { ...s.local, schoolNotificationToken: next } }));
  return next;
}
const extraFor = (n: SchoolNotice, scope: string) => ({ scope, view: n.view, item: n.item ?? "" });
async function show(n: SchoolNotice, scope: string, id: number, details: boolean) {
  await invoke("plugin:notification|show", { id, ...privateNotice(n, details), extra: extraFor(n, scope),
    ...(n.at > Date.now() + 1000 ? { schedule: Schedule.at(new Date(n.at)) } : {}) });
}
export async function testSchoolNotification(): Promise<void> {
  if (await notificationPermission() !== "granted" && !await enableSchoolNotifications()) throw new Error("Notification permission denied");
  await invoke("plugin:notification|show", { id: nextId(), title: "WilmAI Home", body: t("Notifications work. This test contains no school information.") });
}
let running: Promise<void> | null = null, queued = false;
let nativeScope: string | null = null, lastBackground: boolean | null = null, lastDetails: boolean | null = null;
function error(message: string | null) {
  if ((getState().schoolNotificationError ?? null) !== message) setState({ schoolNotificationError: message });
}
async function configureBackground(enabled: boolean) {
  if (appPlatform !== "ios" || lastBackground === enabled) return;
  await invoke("plugin:background-refresh|configure", { enabled });
  lastBackground = enabled;
}
/** Called by explicit sign-out/reset as well as the observer. Drain outstanding sends before clearing OS data. */
export async function clearSchoolNotifications(): Promise<void> {
  if (!isMobileApp) return;
  await running?.catch(() => {});
  await cancelAll(); await removeAllActive(); await configureBackground(false);
  nativeScope = null;
}
async function reconcile() {
  const state = getState();
  if (state.phase === "loading") return;
  const options = notificationOptions(state.settings);
  if (state.phase !== "ready" || !state.snapshot || state.snapshot.account.via === "demo" || state.settings.notify === false) {
    await cancelAll(); await removeAllActive(); await configureBackground(false); nativeScope = null; return;
  }
  if (appPlatform === "ios" && !state.secureStorage.ready) return;
  const scope = accountScope();
  const current = () => scope === accountScope() && getState().phase === "ready" && getState().settings.notify !== false;
  if (await notificationPermission() !== "granted") { await cancelAll(); await configureBackground(false); return; }
  const token = scopeToken();
  if (nativeScope !== token) {
    // Also clears reminders from another family after a cold launch, sign-out or user switch.
    await cancelAll(); await removeAllActive(); nativeScope = token;
  }
  if (!current()) return;
  if (lastDetails !== options.details) { await removeAllActive(); lastDetails = options.details; }
  await configureBackground(options.background);
  if (state.sync.running) return;
  const { ledger, notices } = schoolNotices(state, Date.now());
  const retry = new Set(notices.map((n) => n.id));
  const batch = notices.length > 8 ? [{ ...notices[0], id: "batch", kind: "messages" as const,
    view: "today" as const, item: null, title: t("New school updates"),
    body: t("{n} new school updates. Open the app to read them.", { n: notices.length }) }] : notices;
  let failed = false;
  for (const notice of batch) {
    if (!current()) return;
    try {
      await show({ ...notice, at: Date.now() }, token, nextId(), options.details);
      if (notice.id === "batch") retry.clear(); else retry.delete(notice.id);
    } catch { failed = true; break; }
  }
  for (const notice of notices.filter((n) => retry.has(n.id))) {
    const previous = state.local.schoolNotificationLedger?.sources[notice.source]?.[notice.id];
    if (previous === undefined) delete ledger.sources[notice.source][notice.id];
    else ledger.sources[notice.source][notice.id] = previous;
  }
  if (!current()) return;
  if (JSON.stringify(ledger) !== JSON.stringify(getState().local.schoolNotificationLedger))
    setState((s) => ({ local: { ...s.local, schoolNotificationLedger: ledger } }));
  if (failed) throw new Error("Notification delivery failed");
  const scheduled = scheduledSchoolNotices(getState(), Date.now());
  const old = getState().local.schoolNotificationRequests ?? {};
  const existing = new Set(appPlatform === "ios"
    ? await invoke<number[]>("plugin:background-refresh|pending_ids")
    : (await pending()).map((n) => n.id));
  const requests: Record<string, { id: number; signature: string }> = {};
  for (const notice of scheduled) {
    if (!current()) return;
    const signature = JSON.stringify([notice.fingerprint, notice.at, options.details, getState().settings.language]);
    const previous = old[notice.id];
    const id = previous?.id ?? nextId();
    if (!previous || signature !== previous.signature || !existing.has(id)) await show(notice, token, id, options.details);
    requests[notice.id] = { id, signature };
  }
  if (!current()) return;
  const wanted = new Set(Object.values(requests).map((r) => r.id));
  const removed = [...existing].filter((id) => id < 2_000_000_000 && !wanted.has(id));
  if (removed.length) await invoke("plugin:notification|cancel", { notifications: removed });
  if (JSON.stringify(requests) !== JSON.stringify(old)) setState((s) => ({ local: { ...s.local, schoolNotificationRequests: requests } }));
  await flushPersisted();
  error(null);
}
export function refreshSchoolNotifications(): Promise<void> {
  if (!isMobileApp) return Promise.resolve();
  queued = true;
  running ??= (async () => {
    while (queued) { queued = false; await reconcile(); }
  })().catch(() => error(t("Notifications could not be updated. Open Settings and try again.")))
    .finally(() => { running = null; });
  return running;
}

/** Treat OS payloads as untrusted. A notification can never select a different account or open a URL. */
export function notificationTarget(extra: unknown, token: string | undefined): string | null {
  if (!extra || typeof extra !== "object") return null;
  const value = extra as Record<string, unknown>;
  if (typeof value.scope !== "string" || !/^[a-f0-9]{32}$/.test(value.scope)) return null;
  if (value.scope !== token) return "@wilmas";
  if (!["today", "inbox", "notes", "grades"].includes(String(value.view))) return null;
  if (value.view === "inbox" && typeof value.item === "string" && /^m:\d{1,16}$/.test(value.item)) return value.item;
  return `@${value.view}`;
}
function waitUntilStarted(): Promise<void> {
  if (getState().phase !== "loading") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); stop(); resolve(); };
    const stop = subscribe(() => { if (getState().phase !== "loading" || getState().secureStorage.error) done(); });
    const timer = setTimeout(done, 8000);
  });
}
export function startSchoolNotifications(open: (key: string) => void): () => void {
  let stopped = false, timer: ReturnType<typeof setTimeout> | null = null;
  const listeners: Promise<PluginListener>[] = [];
  const schedule = () => {
    if (timer || stopped) return;
    timer = setTimeout(() => { timer = null; void refreshSchoolNotifications(); }, 500);
  };
  const stop = subscribe(schedule);
  const tap = async (extra: unknown) => {
    await waitUntilStarted(); if (stopped) return;
    const target = notificationTarget(extra, getState().local.schoolNotificationToken);
    if (target) open(target);
  };
  listeners.push(onAction((e) => {
    if (e.actionId === "tap") void tap(e.notification?.extra).then(() => appPlatform === "ios" ? invoke("plugin:background-refresh|take_tap") : undefined).catch(() => {});
  }));
  let refreshing = false;
  const background = async () => {
    if (refreshing || stopped) return;
    refreshing = true;
    let token: string | null = null;
    let success = false;
    try {
      const claimed = await invoke<{ token: string | null }>("plugin:background-refresh|claim"); token = claimed.token;
      if (!token) return;
      await waitUntilStarted();
      const state = getState();
      if (state.phase !== "ready" || !state.secureStorage.ready || state.settings.notify === false || !notificationOptions(state.settings).background) return;
      const began = Date.now();
      const { syncNow } = await import("./engine");
      await syncNow(false, { background: true }); await refreshSchoolNotifications();
      success = (getState().sync.lastOk ?? 0) >= began && !getState().sync.error;
    } finally {
      if (token) await invoke("plugin:background-refresh|complete", { token, success }).catch(() => {});
      refreshing = false;
    }
  };
  if (appPlatform === "ios") {
    listeners.push(addPluginListener("background-refresh", "refresh", () => { void background().catch(() => {}); }));
    void Promise.all(listeners).then(async () => {
      const result = await invoke<{ extra?: unknown }>("plugin:background-refresh|take_tap");
      if (result.extra) await tap(result.extra);
      await background();
    }).catch(() => error(t("Notifications could not be updated. Open Settings and try again.")));
  }
  document.addEventListener("visibilitychange", schedule);
  const clock = setInterval(schedule, 60_000);
  schedule();
  return () => {
    stopped = true; stop(); if (timer) clearTimeout(timer); clearInterval(clock);
    document.removeEventListener("visibilitychange", schedule);
    for (const listener of listeners) void listener.then((l) => l.unregister()).catch(() => {});
  };
}
