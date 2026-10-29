/*
 * Notifications (desktop app). What "Odottaa sinua" shows when it's new
 * becomes a macOS notification, once: a message or bulletin WilmAI
 * Intelligence read as needing the parent, or what Wilma's own data says
 * waits for an answer (an invitation's sign-up). Clicking it opens the item.
 * The evening before a deadline that isn't done, a reminder, once.
 *
 * Never for what was there before notifications began, what has been opened
 * or marked done, anything older than two days (a re-read can't wake up old
 * items), or anything twice. Quiet hours are macOS's (Focus, Do Not Disturb).
 *
 * The app checks Wilma every ten minutes while it runs, the window shown or
 * not: it goes on in the menu bar when the window is closed, and the native
 * side wakes the page (src-tauri/src/shell.rs). Clicking a notification, the
 * menu bar's "Check Wilma now" and the menu bar's count come through here too.
 *
 * Signed out (Wilma ended the session) with nothing to bring the app back by
 * itself (Stay signed in off, or it failed): one notification, "!" beside the
 * menu bar icon, and "Sign in to Wilma…" in its menu, until the parent signs
 * in. Staying signed in, the app gets back by itself (engine's getBack).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getState, setState, subscribe } from "./store";
import { buildFeed, isNeedsYou, needsYou, type FeedItem } from "./feed";
import { addDays, dateOf, deadlineDay, shortDate } from "./dates";
import { isDesktopApp, onWindows } from "../wilma/transport";
import type { LocalState, Snapshot } from "./model";
import { firstSyncOf, loginOfItem, logins } from "./logins";
import { t } from "../i18n";

/** New items notify for this long after they arrive. */
const FRESH_MS = 2 * 86_400_000;
/** A deadline's reminder comes from this hour the evening before. */
const REMINDER_HOUR = 18;

export interface Note {
  /** What it's remembered by in local.notified. */
  id: string;
  /** The item to open on a click. */
  key: string;
  title: string;
  body: string;
}

/** The last day to act on an item: the step's deadline, or an open invitation's sign-up end. */
function dueDay(i: FeedItem): string | null {
  if (i.deadline) return i.deadline;
  const ends = (i.invite?.awaiting ? (i.invite.data?.slots ?? []) : []).map((s) => s.enrollEnd).filter((d): d is Date => Boolean(d));
  return ends.length ? deadlineDay(ends.sort((a, b) => a.getTime() - b.getTime())[0]).day : null;
}

/** "Otso: Oppimiskeskustelut alkavat…" — whose it is first, as the family calendar writes it. */
function titleOf(i: FeedItem, snap: Snapshot): string {
  const names = i.children.map((n) => snap.children.find((c) => c.number === n)?.first).filter(Boolean);
  return names.length && names.length < snap.children.length ? `${names.join(", ")}: ${i.title}` : i.title;
}

/** What to do, in the school's words if read, else what Wilma's data says. */
function stepOf(i: FeedItem): string {
  return i.actionLine ?? i.task?.label ?? t("Needs you");
}

/**
 * What to notify now: new items that need the parent, and tomorrow's deadlines from the evening before. Pure (the clock
 * and the items given), so it can be checked without a window.
 */
export function toNotify(items: FeedItem[], local: LocalState, snap: Snapshot, nowMs: number): Note[] {
  const from = local.notifyFrom ?? nowMs;
  const sent = local.notified ?? {};
  const now = new Date(nowMs);
  const todayIso = dateOf(now);
  const out: Note[] = [];
  for (const i of items) {
    if (!isNeedsYou(i) || i.done) continue;
    const at = i.at.getTime();
    // A Wilma added to the app later notifies from when it was first read (data/logins.ts).
    if (!sent[i.key] && !local.opened[i.key] && at >= Math.max(from, firstSyncOf(snap, loginOfItem(i))) && nowMs - at <= FRESH_MS) {
      const due = dueDay(i);
      out.push({ id: i.key, key: i.key, title: titleOf(i, snap), body: due ? `${stepOf(i)} · ${t("by {date}", { date: shortDate(due) })}` : stepOf(i) });
      continue;
    }
    const due = dueDay(i);
    const id = `${i.key}#due`;
    if (due && due === addDays(todayIso, 1) && now.getHours() >= REMINDER_HOUR && !sent[id])
      out.push({ id, key: i.key, title: titleOf(i, snap), body: t("Tomorrow is the last day: {step}", { step: stepOf(i) }) });
  }
  return out;
}

/* ---------- The desktop app's side ---------- */

let pending: ReturnType<typeof setTimeout> | null = null;
let lastTitle: string | null = null;
let lastSignedOut: boolean | null = null;
/** The notification for this sign-out has gone (reset when signed in again). */
let signOutNotified = false;

function trayTitle(title: string) {
  if (title === lastTitle) return;
  lastTitle = title;
  void invoke("tray_title", { title }).catch(() => {});
}

/** Signed out with nothing bringing the app back by itself: the parent is needed. */
function needsSigningIn(): boolean {
  const { phase, snapshot, settings, loginStatus } = getState();
  const stuck = snapshot ? logins(snapshot).some((l) => l.signedOut || loginStatus[l.slot]?.failed) : false;
  return phase === "signed-out" && Boolean(snapshot) && snapshot!.account.via !== "demo" && (!settings.staySignedIn || stuck);
}

/** Why a Wilma of the family couldn't be signed in again by itself, if one couldn't. */
const failedWhy = (): string | null => Object.values(getState().loginStatus).find((s) => s.failed)?.failed ?? null;

/** Notify what's new, and keep the menu bar's count, after the app's state changes (a little later, once things settle). */
function schedule() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    const state = getState();
    const snap = state.snapshot;
    // Signed out or back in: the menu bar's menu says what "Check Wilma now" does.
    const signedOut = state.phase === "signed-out";
    if (signedOut !== lastSignedOut) {
      lastSignedOut = signedOut;
      trayLabels();
    }
    if (signedOut) {
      const needed = needsSigningIn();
      trayTitle(needed ? "!" : "");
      if (needed && !signOutNotified && state.settings.notify !== false && document.visibilityState === "hidden") {
        signOutNotified = true;
        const failed = failedWhy();
        const body = failed
          ? t("Wilma signed WilmAI Home out, and signing in again didn't work: {why}", { why: failed })
          : t("Wilma signed WilmAI Home out. Sign in to keep getting notifications.");
        void invoke("notify", { title: "WilmAI Home", body, key: "signin" }).catch(() => {});
      }
      return;
    }
    if (!snap || state.phase !== "ready") return;
    signOutNotified = false;
    const items = buildFeed(state);
    const count = needsYou(items).length;
    trayTitle(count > 0 ? String(count) : "");
    // Notifications begin now: what's already here doesn't notify.
    if (!state.local.notifyFrom) {
      setState((s) => ({ local: { ...s.local, notifyFrom: Date.now() } }));
      return;
    }
    if (state.settings.notify === false) return;
    const notes = toNotify(items, state.local, snap, Date.now());
    if (!notes.length) return;
    setState((s) => ({ local: { ...s.local, notified: { ...s.local.notified, ...Object.fromEntries(notes.map((n) => [n.id, Date.now()])) } } }));
    for (const n of notes) void invoke("notify", { title: n.title, body: n.body, key: n.key }).catch(() => {});
  }, 3000);
}

/** A test notification from Settings (the first one may make macOS ask whether the app may notify). */
export function testNotification(): Promise<unknown> {
  return invoke("notify", { title: "WilmAI Home", body: t("Notifications work. This is how something that needs you will show."), key: null });
}

/** The menu bar's menu in the app's language; signed out, its check is "Sign in to Wilma…". */
export function trayLabels(): void {
  if (!isDesktopApp) return;
  const check = getState().phase === "signed-out" ? t("Sign in to Wilma…") : t("Check Wilma now");
  void invoke("tray_labels", { open: t("Open WilmAI Home"), check, update: t("Check for app updates…"), quit: t("Quit WilmAI Home") }).catch(() => {});
}

/** Bring the window up (signed out: on the sign-in page). */
export function showWindow(): void {
  if (isDesktopApp) void invoke("show_main").catch(() => {});
}

/**
 * Start in the desktop app: notifications after changes, the native side's ten-minute tick, "Check Wilma now", and
 * a clicked notification opening its item. `tick` checks Wilma if it's time; `checkNow` checks at once; `open` opens an item.
 */
export function startNotifications(tick: () => void, checkNow: () => void, open: (key: string) => void): () => void {
  if (!isDesktopApp) return () => {};
  const stops = [subscribe(schedule)];
  const listening = [
    listen("wilmai:tick", () => tick()),
    listen("wilmai:check", () => checkNow()),
    listen<string>("wilmai:open", (e) => open(e.payload)),
    listen("wilmai:hidden", () => tellWhereItWent()),
  ];
  trayLabels();
  schedule();
  return () => {
    for (const stop of stops) stop();
    for (const l of listening) void l.then((unlisten) => unlisten());
  };
}

export const notificationsAvailable = isDesktopApp;

/** The first time a Windows user closes the window, where the app went: Windows apps usually quit then. */
function tellWhereItWent(): void {
  const state = getState();
  if (!onWindows || state.local.trayTold || state.settings.notify === false) return;
  setState((s) => ({ local: { ...s.local, trayTold: Date.now() } }));
  const body = t("WilmAI Home is still running and checks Wilma. Its icon is by the clock (maybe behind ^); right-click it to quit.");
  void invoke("notify", { title: "WilmAI Home", body, key: null }).catch(() => {});
}
