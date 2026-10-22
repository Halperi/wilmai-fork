/*
 * Everything the app knows, in this browser only: the Wilma snapshot,
 * what the parent did here, Jev's answers (IndexedDB) and settings
 * (localStorage). Nothing is sent anywhere except Wilma and, when turned
 * on, Jev.
 *
 * Secrets are kept like the WilmAI CLI keeps its saved logins: on this
 * computer, scrambled (base64 with a prefix, as `obfuscateSecret` in the
 * CLI), not encrypted. The Wilma session is in IndexedDB, the Jev and
 * OpenAI keys in localStorage. Scrambled only so a glance at the files doesn't show them;
 * anyone with the user's account can read them, and the README says so.
 */
import { useSyncExternalStore } from "react";
import { clear, del, get, set } from "idb-keyval";
import { oldKeychain } from "../wilma/transport";
import { t } from "../i18n";
import { DEFAULT_SETTINGS, keepsPassword, viewerOf, type AccountInfo, type JevRecord, type LocalState, type LunaRecord, type Settings, type Snapshot, type UsageBucket, type Viewer } from "./model";
import { normalizeAIBudget } from "./ai-budget";
import type { CalEvent } from "./calendar";

export interface SyncStatus {
  running: boolean;
  step: string | null;
  error: string | null;
  lastOk: number | null;
}

export interface JevStatus {
  running: boolean;
  done: number;
  total: number;
  error: string | null;
  calls: number;
  inputTokens: number;
  /** This visit's questions: about items Jev hadn't seen, and items whose content changed since (by part). */
  newItems: number;
  changedItems: number;
  changedParts: Record<string, number>;
}

export interface AppState {
  phase: "loading" | "signed-out" | "ready";
  /** Why the parent is looking at the sign-in page again, if it isn't the first time. */
  signedOutReason: string | null;
  /** Staying signed in, while signed out: when the app signs in again (a pause while Wilma is in use elsewhere), or why it can't. */
  rejoin: { at: number | null; failed: string | null };
  snapshot: Snapshot | null;
  local: LocalState;
  jev: Record<string, JevRecord>;
  /** Jev's own answers from before the experiment, put aside to compare Luna's with (luna/compare.ts). */
  jevBaseline: Record<string, JevRecord>;
  /** The Luna experiment: what Luna read, by item key, and the OpenAI usage by month. */
  luna: Record<string, LunaRecord>;
  usage: Record<string, UsageBucket>;
  settings: Settings;
  sync: SyncStatus;
  jevStatus: JevStatus;
  lunaStatus: { running: boolean; done: number; total: number; error: string | null };
  /** A newer version published on wilm.ai (see data/updates.ts). */
  update: import("./update-state").UpdateState;
  /** OpenAI couldn't be reached from this network (blocked, or no connection), and since when: AI waits (luna/client.ts). */
  openaiBlocked: { at: number; reason: "network" | "intercepted"; detail: string | null } | null;
}

export interface SavedSession {
  account: AccountInfo;
  /** wilma-client's exportSession(): the login's cookies ("" when Wilma ended it). */
  state: string;
  /** The login's key in WilmAI's shared session file (see sharedSessionFor). */
  sharedKey?: string;
}

/** Sessions saved before the app used wilma-client kept bare cookie pairs. */
function upgradeSession(saved: (SavedSession & { cookies?: [string, string][] }) | undefined): SavedSession | null {
  if (!saved?.account) return null;
  if (typeof saved.state === "string") return saved;
  if (!Array.isArray(saved.cookies)) return null;
  const domain = new URL(saved.account.baseUrl).hostname;
  const cookies = saved.cookies.map(([key, value]) => ({ key, value, domain, path: "/", hostOnly: true }));
  return { account: saved.account, state: JSON.stringify({ cookies }) };
}

const SETTINGS_KEY = "wilmai.settings";
const JEV_KEY = "wilmai.jevKey";
const OPENAI_KEY = "wilmai.openaiKey";
const WILMA_PASSWORD = "wilmai.wilmaPassword";
/** Set once the key in the old keychain place has been looked for (so macOS asks at most once more). */
const MOVED_KEY = "wilmai.keyMoved";
const SECRET_PREFIX = "wilmai::";

/** Scrambled, not encrypted (the CLI's `obfuscateSecret`): base64 of a prefix and the secret. */
function scramble(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(SECRET_PREFIX + value)));
}

function unscramble(value: string | null): string | null {
  if (!value) return null;
  try {
    const text = new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));
    return text.startsWith(SECRET_PREFIX) ? text.slice(SECRET_PREFIX.length) : null;
  } catch {
    return null;
  }
}

function loadSettings(): Settings {
  try {
    // An older browser setup kept the key in the settings as it was; it moves out on the next save.
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Settings>;
    // The app reads with GPT-6 Luna (another model was a choice during the experiment; the eval suite still tries others).
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      aiMonthlyBudgetUsd: normalizeAIBudget(saved.aiMonthlyBudgetUsd),
      readingModel: DEFAULT_SETTINGS.readingModel,
      jevKey: unscramble(localStorage.getItem(JEV_KEY)) ?? saved.jevKey ?? "",
      openaiKey: unscramble(localStorage.getItem(OPENAI_KEY)) ?? "",
      wilmaPassword: unscramble(localStorage.getItem(WILMA_PASSWORD)) ?? "",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let state: AppState = {
  phase: "loading",
  signedOutReason: null,
  rejoin: { at: null, failed: null },
  snapshot: null,
  local: { opened: {}, done: {} },
  jev: {},
  jevBaseline: {},
  luna: {},
  usage: {},
  settings: loadSettings(),
  sync: { running: false, step: null, error: null, lastOk: null },
  jevStatus: { running: false, done: 0, total: 0, error: null, calls: 0, inputTokens: 0, newItems: 0, changedItems: 0, changedParts: {} },
  lunaStatus: { running: false, done: 0, total: 0, error: null },
  update: { available: null, current: null, checkedAt: null, error: null, phase: "idle", progress: null },
  openaiBlocked: null,
};

// A key an older version kept plainly in the settings moves to its scrambled place now.
try {
  if ("jevKey" in JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}")) saveSettings();
} catch {
  // Unreadable settings were already replaced by the defaults.
}

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const next = typeof patch === "function" ? patch(state) : patch;
  if ("snapshot" in next && accountKey(next.snapshot?.account) !== accountKey(state.snapshot?.account)) accountGeneration += 1;
  state = { ...state, ...next };
  for (const listener of listeners) listener();
  schedulePersist(next);
}

/** Called after every change (outside React: notifications). */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => select(state)
  );
}

/* Persistence: debounced, per part, so a burst of sync steps is one write. */
const dirty = new Set<"snapshot" | "local" | "jev" | "jevBaseline" | "luna" | "usage">();
let timer: ReturnType<typeof setTimeout> | null = null;
type AccountCache = Pick<AppState, "snapshot" | "local" | "jev" | "jevBaseline" | "luna">;
let accounts: Record<string, AccountCache> = {};
let accountGeneration = 0;
let resetGeneration = 0;
let writes: Promise<void> = Promise.resolve();

/** School and username identify a cache; sample data has a separate identity. */
export function accountKey(account?: AccountInfo): string | null {
  if (!account) return null;
  if (account.via === "demo") return "demo";
  return JSON.stringify([account.baseUrl.replace(/\/$/, "").toLowerCase(), account.username.trim().toLowerCase()]);
}

/** Async readers must not publish an old account's answer into a new account. */
export const accountScope = () => accountGeneration;
export const resetScope = () => resetGeneration;

function rememberAccount() {
  const key = accountKey(state.snapshot?.account);
  if (!key) return;
  const { snapshot, local, jev, jevBaseline, luna } = state;
  accounts = { ...accounts, [key]: { snapshot, local, jev, jevBaseline, luna } };
}

/** Keep the current account and restore the next one's cache before syncing Wilma. */
export function activateAccount(account: AccountInfo | null) {
  rememberAccount();
  const cached = account ? accounts[accountKey(account)!] : undefined;
  setState({
    snapshot: cached?.snapshot && account ? { ...cached.snapshot, account } : null,
    local: cached?.local ?? { opened: {}, done: {} },
    jev: cached?.jev ?? {}, jevBaseline: cached?.jevBaseline ?? {}, luna: cached?.luna ?? {},
    sync: { running: false, step: null, error: null, lastOk: cached?.snapshot?.syncedAt?.getTime() ?? null },
    jevStatus: { running: false, done: 0, total: 0, error: null, calls: 0, inputTokens: 0, newItems: 0, changedItems: 0, changedParts: {} },
    lunaStatus: { running: false, done: 0, total: 0, error: null },
    signedOutReason: null, rejoin: { at: null, failed: null },
  });
}

/** Drafts and child filters belong to the account, even when item IDs overlap. */
export function accountStorageKey(part: string): string {
  return `wilmai.account.${encodeURIComponent(accountKey(state.snapshot?.account) ?? "signed-out")}.${part}`;
}

function migrateAccountStorage() {
  if (!state.snapshot) return;
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (!key || !/^wilmai\.(draft\.|newmsg\.|children$)/.test(key)) continue;
    localStorage.setItem(accountStorageKey(key.slice("wilmai.".length)), localStorage.getItem(key)!);
    localStorage.removeItem(key);
  }
}

function saveSettings() {
  const { jevKey, openaiKey, wilmaPassword, ...rest } = state.settings;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
  // The Wilma password while it's remembered (one-click sign-in) or staying signed in needs it.
  if (wilmaPassword && keepsPassword(rest)) localStorage.setItem(WILMA_PASSWORD, scramble(wilmaPassword));
  else localStorage.removeItem(WILMA_PASSWORD);
  if (jevKey) localStorage.setItem(JEV_KEY, scramble(jevKey));
  else localStorage.removeItem(JEV_KEY);
  if (openaiKey) localStorage.setItem(OPENAI_KEY, scramble(openaiKey));
  else localStorage.removeItem(OPENAI_KEY);
}

/**
 * Desktop app: earlier versions kept the Jev key in the system keychain,
 * where macOS asks for the password again after every new build of an app
 * that isn't signed with a Developer ID. Look there once, move the key into
 * the app's own storage, and never look again. Nothing waits for this: the
 * app shows at once and Jev starts when the key is in.
 */
export async function loadSecrets(): Promise<void> {
  const generation = resetScope();
  if (!oldKeychain || localStorage.getItem(MOVED_KEY)) return;
  localStorage.setItem(MOVED_KEY, "1");
  if (state.settings.jevKey) return;
  const stored = await oldKeychain.get("jev-key").catch(() => null);
  // A key typed in Settings meanwhile wins.
  if (generation === resetScope() && stored && !state.settings.jevKey) updateSettings({ jevKey: stored });
}

function schedulePersist(patch: Partial<AppState>) {
  if ("settings" in patch) saveSettings();
  if ("snapshot" in patch) dirty.add("snapshot");
  if ("local" in patch) dirty.add("local");
  if ("jev" in patch) dirty.add("jev");
  if ("luna" in patch) dirty.add("luna");
  if ("jevBaseline" in patch) dirty.add("jevBaseline");
  if ("usage" in patch) dirty.add("usage");
  if (!dirty.size || timer) return;
  timer = setTimeout(() => {
    void flushPersisted();
  }, 400);
}

/** Drain pending writes before switching accounts, closing or resetting. */
export function flushPersisted(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const parts = [...dirty];
  dirty.clear();
  rememberAccount();
  const values = parts.map((part) => [part, state[part]] as const);
  const savedAccounts = accounts;
  writes = writes.then(async () => {
    await Promise.all([...values.map(([part, value]) => set(part, value)), ...(parts.some((p) => p !== "usage") ? [set("accounts", savedAccounts)] : [])]);
  }).catch(() => {}); // No IndexedDB in pure eval runs.
  return writes;
}

export async function loadPersisted(): Promise<{ session: SavedSession | null }> {
  const [snapshot, local, jev, session, luna, usage, jevBaseline, savedAccounts] = await Promise.all([
    get<Snapshot>("snapshot"),
    get<LocalState>("local"),
    get<Record<string, JevRecord>>("jev"),
    get<SavedSession>("session"),
    get<Record<string, LunaRecord>>("luna"),
    get<Record<string, UsageBucket>>("usage"),
    get<Record<string, JevRecord>>("jevBaseline"),
    get<Record<string, AccountCache>>("accounts"),
  ]).catch(() => [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined] as const);
  state = {
    ...state,
    snapshot: snapshot ?? null,
    local: local ?? state.local,
    jev: jev ?? {},
    luna: luna ?? {},
    usage: usage ?? {},
    jevBaseline: jevBaseline ?? {},
  };
  accounts = savedAccounts ?? {};
  rememberAccount(); // Migrate the existing installation without losing its AI results.
  migrateAccountStorage();
  return { session: upgradeSession(session) };
}

/** The session kept for the next start (the login it came from, "" state when Wilma ended it). */
export async function savedSession(): Promise<SavedSession | null> {
  return upgradeSession(await get<SavedSession>("session").catch(() => undefined));
}

export function saveSession(session: SavedSession | null) {
  writes = writes.then(() => session ? set("session", session) : del("session")).catch(() => {});
  return writes;
}

export function updateSettings(patch: Partial<Settings>) {
  setState((s) => ({ settings: { ...s.settings, ...patch, aiMonthlyBudgetUsd: normalizeAIBudget(patch.aiMonthlyBudgetUsd ?? s.settings.aiMonthlyBudgetUsd) } }));
}

/** Forget everything this app stored on this device. */
export async function forgetEverything() {
  resetGeneration += 1;
  if (timer) clearTimeout(timer);
  timer = null;
  dirty.clear();
  await writes;
  await clear();
  accounts = {};
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key?.startsWith("wilmai.")) localStorage.removeItem(key);
  }
  // A reset must not import a key from an earlier version on the next launch.
  localStorage.setItem(MOVED_KEY, "1");
  setState({ settings: { ...DEFAULT_SETTINGS }, usage: {} });
  await flushPersisted();
}

/** Who the app is for on the current account: a guardian or the student themself. */
export const viewer = (): Viewer => viewerOf(state.snapshot?.account, state.local);
export const useViewer = (): Viewer => useApp((s) => viewerOf(s.snapshot?.account, s.local));

/** Choose who the app is for on this account (Settings); null goes back to what Wilma says. */
export function setViewAs(viewAs: Viewer | null) {
  setState((s) => {
    const local = { ...s.local };
    if (viewAs) local.viewAs = viewAs;
    else delete local.viewAs;
    return { local };
  });
}

export function markOpened(key: string) {
  if (state.local.opened[key]) return;
  setState((s) => ({ local: { ...s.local, opened: { ...s.local.opened, [key]: Date.now() } } }));
}

/** Take ("yes") or dismiss ("no") a calendar event, or forget the answer (null): kept on its key, and off its other keys (a twin's). */
export function setCalendarDecision(e: Pick<CalEvent, "key" | "aliases">, decision: "yes" | "no" | null) {
  setState((s) => {
    const calendar = s.local.calendar ?? { decisions: {}, kinds: {} };
    const decisions = { ...calendar.decisions };
    for (const alias of e.aliases ?? []) delete decisions[alias];
    if (decision) decisions[e.key] = decision;
    else delete decisions[e.key];
    return { local: { ...s.local, calendar: { ...calendar, decisions } } };
  });
}

/** Whether a kind of event goes to the family calendar. */
export function setCalendarKind(kind: string, on: boolean) {
  setState((s) => {
    const calendar = s.local.calendar ?? { decisions: {}, kinds: {} };
    return { local: { ...s.local, calendar: { ...calendar, kinds: { ...calendar.kinds, [kind]: on } } } };
  });
}

/** Pin an item to the top of the inbox, or unpin it (only in this app; nothing changes in Wilma). */
export function togglePinned(key: string) {
  setState((s) => {
    const pinned = { ...s.local.pinned };
    if (pinned[key]) delete pinned[key];
    else pinned[key] = Date.now();
    return { local: { ...s.local, pinned } };
  });
}

export function toggleDone(key: string) {
  setState((s) => {
    const done = { ...s.local.done };
    if (done[key]) delete done[key];
    else done[key] = Date.now();
    return { local: { ...s.local, done } };
  });
}
