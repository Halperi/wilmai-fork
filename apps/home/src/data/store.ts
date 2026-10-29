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
import { clear, delMany, get, set } from "idb-keyval";
import { oldKeychain } from "../wilma/transport";
import { t } from "../i18n";
import { DEFAULT_SETTINGS, keepsPassword, viewerOf, type AccountInfo, type ItemTranslation, type JevRecord, type LocalState, type LunaRecord, type Settings, type Snapshot, type UsageBucket, type Viewer } from "./model";
import { normalizeAIBudget } from "./ai-budget";
import type { CalEvent } from "./calendar";
import { accountId, type AccountId } from "./account-id";

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
  /** Items translated into the language chosen in Settings, by item key (data/translations.ts). */
  translations: Record<string, ItemTranslation>;
  /** Wilma's short texts translated (data/phrases.ts), by language and text: for every account on this computer. */
  phrases: Record<string, string>;
  /** The translations' background run, and the items being translated now. */
  translationStatus: { running: boolean; done: number; total: number; error: string | null; busy: string[] };
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
  translations: {},
  phrases: {},
  translationStatus: { running: false, done: 0, total: 0, error: null, busy: [] },
  settings: loadSettings(),
  sync: { running: false, step: null, error: null, lastOk: null },
  jevStatus: { running: false, done: 0, total: 0, error: null, calls: 0, inputTokens: 0, newItems: 0, changedItems: 0, changedParts: {} },
  lunaStatus: { running: false, done: 0, total: 0, error: null },
  update: { available: null, current: null, checkedAt: null, error: null, phase: "idle", progress: null },
  openaiBlocked: null,
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const next = typeof patch === "function" ? patch(state) : patch;
  const account = next.snapshot?.account;
  if (account && accountKey(account) !== selectedId) activateAccount(account);
  if (selectedId) applyAccount(ensureAccount(records.get(selectedId)!.account), next);
  else {
    state = { ...state, ...next };
    schedulePersist(next);
    emit();
  }
}

function emit() { for (const listener of listeners) listener(); }

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
const dirty = new Set<"snapshot" | "local" | "jev" | "jevBaseline" | "luna" | "usage" | "translations" | "phrases">();
let timer: ReturnType<typeof setTimeout> | null = null;
type AccountCache = Pick<AppState, "snapshot" | "local" | "jev" | "jevBaseline" | "luna" | "translations">;
type AccountAuth = Pick<Settings, "staySignedIn" | "rememberPassword" | "wilmaPassword">;
interface AccountRecord {
  id: AccountId;
  account: AccountInfo;
  state: AppState;
  cache: AccountCache;
  session: SavedSession | null;
  generation: number;
}
interface PersistedAccounts {
  version: 2;
  selectedId: AccountId | null;
  accounts: Record<string, { account: AccountInfo; cache: AccountCache; session: SavedSession | null; auth: Omit<AccountAuth, "wilmaPassword">; showCache: boolean }>;
}
const ACCOUNTS_KEY = "accounts.v2";
const records = new Map<AccountId, AccountRecord>();
let selectedId: AccountId | null = null;
let accountGeneration = 0;
let resetGeneration = 0;
let writes: Promise<void> = Promise.resolve();
let accountsDirty = false;

// A key an older version kept plainly in the settings moves to its scrambled place now.
try {
  if ("jevKey" in JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}")) saveSettings();
} catch {
  // Unreadable settings were already replaced by the defaults.
}

/** Compatible with the old cache identity; credentials and CLI list positions are never identities. */
export const accountKey = (account?: AccountInfo): AccountId | null => account ? accountId(account) : null;
export const selectedAccountId = (): AccountId | null => selectedId;
export const knownAccounts = (): AccountInfo[] => [...records.values()].map((r) => r.account);
export const accountScope = () => accountGeneration;
export const resetScope = () => resetGeneration;
export function invalidateAccountScope() {
  accountGeneration += 1;
  if (selectedId) records.get(selectedId)!.generation += 1;
}

function blankCache(): AccountCache {
  return { snapshot: null, local: { opened: {}, done: {} }, jev: {}, jevBaseline: {}, luna: {}, translations: {} };
}

function passwordKey(id: AccountId): string { return `wilmai.account.${encodeURIComponent(id)}.wilmaPassword`; }
function authOf(settings: Settings): AccountAuth {
  return { staySignedIn: settings.staySignedIn, rememberPassword: settings.rememberPassword, wilmaPassword: settings.wilmaPassword };
}
function sharedSettings(settings: Settings): Omit<Settings, keyof AccountAuth> {
  const { staySignedIn, rememberPassword, wilmaPassword, ...shared } = settings;
  return shared;
}
function cacheOf(s: AppState): AccountCache {
  const { snapshot, local, jev, jevBaseline, luna, translations } = s;
  return { snapshot, local, jev, jevBaseline, luna, translations };
}
function ensureAccount(account: AccountInfo): AccountRecord {
  const id = accountId(account);
  const existing = records.get(id);
  if (existing) return existing;
  const cache = blankCache();
  const record: AccountRecord = { id, account, cache, session: null, generation: 0,
    state: { ...state, ...cache, phase: "signed-out", signedOutReason: null, rejoin: { at: null, failed: null },
      settings: { ...state.settings, staySignedIn: false, rememberPassword: undefined, wilmaPassword: "" },
      sync: { running: false, step: null, error: null, lastOk: null },
      translationStatus: { running: false, done: 0, total: 0, error: null, busy: [] },
      jevStatus: { running: false, done: 0, total: 0, error: null, calls: 0, inputTokens: 0, newItems: 0, changedItems: 0, changedParts: {} },
      lunaStatus: { running: false, done: 0, total: 0, error: null } } };
  records.set(id, record);
  return record;
}
function rememberAccount(record?: AccountRecord) {
  if (record?.state.snapshot) record.cache = cacheOf(record.state);
}
function applyAccount(record: AccountRecord, patch: Partial<AppState>) {
  if (patch.snapshot && accountId(patch.snapshot.account) !== record.id) throw new Error("An account store cannot accept another account's snapshot");
  if (patch.snapshot) record.account = patch.snapshot.account;
  const before = record.state;
  record.state = { ...before, ...patch };
  if ("snapshot" in patch && accountKey(before.snapshot?.account) !== accountKey(patch.snapshot?.account)) record.generation += 1;
  rememberAccount(record);
  // AI keys, budget and display preferences are device-wide. Login choices and passwords are per account.
  const shared: Partial<AppState> = {};
  for (const key of ["usage", "phrases", "update", "openaiBlocked"] as const) {
    if (key in patch) Object.assign(shared, { [key]: patch[key] });
  }
  if (patch.settings) {
    for (const other of records.values()) {
      if (other !== record) other.state = { ...other.state, settings: { ...sharedSettings(patch.settings), ...authOf(other.state.settings) } };
    }
    if (!selectedId) state = { ...state, settings: { ...sharedSettings(patch.settings), ...authOf(state.settings) } };
    saveAccountPassword(record);
  }
  if (Object.keys(shared).length) {
    for (const other of records.values()) if (other !== record) other.state = { ...other.state, ...shared };
    state = { ...state, ...shared };
  }
  if (selectedId === record.id) {
    if ("snapshot" in patch && accountKey(before.snapshot?.account) !== accountKey(patch.snapshot?.account)) accountGeneration += 1;
    state = record.state;
  } else if (selectedId) state = records.get(selectedId)!.state;
  accountsDirty = true;
  schedulePersist(patch);
  emit();
}

/** A stable store handle for async work: selecting another account never changes its target. */
export function accountStore(account: AccountInfo | null) {
  if (!account) return { id: null, current: () => true, storageKey: accountStorageKey, getState, setState, accountScope, invalidateAccountScope, activateAccount, updateSettings, setViewAs, savedSession, saveSession };
  const record = ensureAccount(account);
  const current = () => records.get(record.id) === record;
  const update = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => {
    if (!current()) return; // A handle retained across reset cannot recreate erased data.
    applyAccount(record, typeof patch === "function" ? patch(record.state) : patch);
  };
  return {
    id: record.id,
    current,
    storageKey: (part: string) => accountStorageKey(part, record.id),
    getState: () => record.state,
    setState: update,
    accountScope: () => record.generation,
    invalidateAccountScope: () => { record.generation += 1; if (selectedId === record.id) accountGeneration += 1; },
    activateAccount: (next: AccountInfo | null) => {
      if (next && accountId(next) !== record.id) throw new Error("Wrong account runtime");
      rememberAccount(record);
      update(next ? { ...record.cache } : { ...blankCache() });
    },
    updateSettings: (patch: Partial<Settings>) => update({ settings: { ...record.state.settings, ...patch, aiMonthlyBudgetUsd: normalizeAIBudget(patch.aiMonthlyBudgetUsd ?? record.state.settings.aiMonthlyBudgetUsd) } }),
    setViewAs: (viewAs: Viewer | null) => {
      const local = { ...record.state.local };
      if (viewAs) local.viewAs = viewAs; else delete local.viewAs;
      update({ local });
    },
    savedSession: async () => { await writes; return current() ? record.session : null; },
    saveSession: (session: SavedSession | null, valid = () => true): Promise<void> => {
      if (session && accountId(session.account) !== record.id) throw new Error("Wrong account session");
      writes = writes.then(async () => {
        if (!current() || !valid()) return;
        record.session = session;
        await set(ACCOUNTS_KEY, persistedAccounts());
      }).catch(() => {});
      return writes;
    },
  };
}

/** Keep the UI on one account for now; every runtime retains its own state in the background. */
export function activateAccount(account: AccountInfo | null) {
  if (selectedId) rememberAccount(records.get(selectedId));
  const next = account ? ensureAccount(account) : null;
  if (selectedId !== next?.id) accountGeneration += 1;
  selectedId = next?.id ?? null;
  if (next) {
    if (!next.state.snapshot && next.cache.snapshot) next.state = { ...next.state, ...next.cache };
    state = next.state;
  } else state = { ...state, ...blankCache(), settings: { ...state.settings, staySignedIn: false, rememberPassword: undefined, wilmaPassword: "" } };
  accountsDirty = true;
  schedulePersist({ snapshot: state.snapshot });
  emit();
}

/** Select without reviving a deliberately signed-out account's cached snapshot. */
export function selectAccount(id: AccountId) {
  const record = records.get(id);
  if (!record) throw new Error("Unknown account");
  if (selectedId !== id) accountGeneration += 1;
  selectedId = id;
  state = record.state;
  accountsDirty = true;
  schedulePersist({});
  emit();
}

function persistedAccounts(): PersistedAccounts {
  return { version: 2, selectedId, accounts: Object.fromEntries([...records].map(([id, record]) => {
    rememberAccount(record);
    const { wilmaPassword, ...auth } = authOf(record.state.settings);
    return [id, { account: record.account, cache: record.cache, session: record.session, auth, showCache: !!record.state.snapshot }];
  })) };
}

/** Drafts and child filters belong to the account, even when item IDs overlap. */
export function accountStorageKey(part: string, id: AccountId | null = selectedId): string {
  return `wilmai.account.${encodeURIComponent(id ?? "signed-out")}.${part}`;
}

function migrateAccountStorage() {
  if (!state.snapshot) return;
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (!key || !/^wilmai\.(draft\.|newmsg\.|children$|sessionHistory$)/.test(key)) continue;
    localStorage.setItem(accountStorageKey(key.slice("wilmai.".length)), localStorage.getItem(key)!);
    localStorage.removeItem(key);
  }
}

function saveAccountPassword(record: AccountRecord) {
  const { wilmaPassword, ...settings } = record.state.settings;
  if (wilmaPassword && keepsPassword(settings)) localStorage.setItem(passwordKey(record.id), scramble(wilmaPassword));
  else localStorage.removeItem(passwordKey(record.id));
}
function saveSettings() {
  const { jevKey, openaiKey, wilmaPassword, ...rest } = state.settings;
  // Before the first account is loaded, preserve legacy login flags for migration.
  if (selectedId || records.size) { delete rest.staySignedIn; delete rest.rememberPassword; }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
  if (jevKey) localStorage.setItem(JEV_KEY, scramble(jevKey)); else localStorage.removeItem(JEV_KEY);
  if (openaiKey) localStorage.setItem(OPENAI_KEY, scramble(openaiKey)); else localStorage.removeItem(OPENAI_KEY);
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
  if ("translations" in patch) dirty.add("translations");
  if ("phrases" in patch) dirty.add("phrases");
  if ((!dirty.size && !accountsDirty) || timer) return;
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
  const saveAccounts = accountsDirty;
  accountsDirty = false;
  // Capture only global parts here; account/session data is read when the serialized write runs.
  const values = parts.filter((p) => p === "usage" || p === "phrases").map((p) => [p, state[p]] as const);
  writes = writes.then(async () => {
    await Promise.all([...values.map(([part, value]) => set(part, value)), ...(saveAccounts ? [set(ACCOUNTS_KEY, persistedAccounts())] : [])]);
  }).catch(() => {}); // No IndexedDB in pure eval runs.
  return writes;
}

export async function loadPersisted(): Promise<{ session: SavedSession | null }> {
  await writes;
  const generation = resetScope();
  const saved = await get<PersistedAccounts>(ACCOUNTS_KEY);
  const [usage, phrases] = await Promise.all([get<AppState["usage"]>("usage"), get<AppState["phrases"]>("phrases")]).catch(() => [undefined, undefined]);
  if (generation !== resetScope()) return { session: null };
  for (const record of records.values()) record.generation += 1;
  records.clear();
  selectedId = null;
  state = { ...state, ...blankCache(), phase: "loading", usage: usage ?? {}, phrases: phrases ?? {}, settings: { ...state.settings, staySignedIn: false, rememberPassword: undefined, wilmaPassword: "" } };
  if (saved && saved.version !== 2) throw new Error("Unsupported account storage version; data was left intact");
  if (saved) {
    for (const [id, entry] of Object.entries(saved.accounts)) {
      if (id !== accountId(entry.account)) throw new Error("Account storage identity mismatch; data was left intact");
      const record = ensureAccount(entry.account);
      record.cache = { ...blankCache(), ...entry.cache };
      record.session = upgradeSession(entry.session ?? undefined);
      if (record.session && accountId(record.session.account) !== id) throw new Error("Account session identity mismatch");
      record.state = { ...record.state, ...(entry.showCache ? record.cache : {}), settings: { ...record.state.settings, ...entry.auth, wilmaPassword: unscramble(localStorage.getItem(passwordKey(record.id))) ?? "" } };
    }
    if (saved.selectedId && records.has(saved.selectedId)) selectAccount(saved.selectedId);
    await retireLegacyData();
  } else {
    // Version 1: merge the active snapshot with the earlier per-account cache, without assigning its login choices to other accounts.
    const [snapshot, local, jev, session, luna, jevBaseline, caches, translations] = await Promise.all([
      get<Snapshot>("snapshot"), get<AppState["local"]>("local"), get<AppState["jev"]>("jev"), get<SavedSession>("session"),
      get<AppState["luna"]>("luna"), get<AppState["jevBaseline"]>("jevBaseline"), get<Record<string, Partial<AccountCache>>>("accounts"), get<AppState["translations"]>("translations"),
    ]);
    if (generation !== resetScope()) return { session: null };
    for (const cache of Object.values(caches ?? {})) {
      if (!cache.snapshot) continue;
      const record = ensureAccount(cache.snapshot.account);
      record.cache = { ...blankCache(), ...cache };
      record.state = { ...record.state, ...record.cache };
    }
    const upgraded = upgradeSession(session);
    if (snapshot && upgraded && accountId(snapshot.account) !== accountId(upgraded.account)) throw new Error("Legacy snapshot and session accounts differ; data was left intact");
    const account = snapshot?.account ?? upgraded?.account;
    if (account) {
      const record = ensureAccount(account);
      if (snapshot) record.cache = { snapshot, local: local ?? { opened: {}, done: {} }, jev: jev ?? {}, luna: luna ?? {}, jevBaseline: jevBaseline ?? {}, translations: translations ?? {} };
      record.session = upgraded;
      record.state = { ...record.state, ...record.cache, settings: { ...record.state.settings, ...authOf(loadSettings()) } };
      selectAccount(record.id);
      // Migration writes complete before the legacy secret is removed; repeatable after interruption.
      saveAccountPassword(record);
      migrateAccountStorage();
    }
    if (records.size) {
      await set(ACCOUNTS_KEY, persistedAccounts());
      await retireLegacyData();
    }
  }
  emit();
  return { session: selectedId ? records.get(selectedId)!.session : null };
}

async function retireLegacyData() {
  // Only after the v2 transaction committed. Old global cookies must not survive a deliberate v2 sign-out.
  await delMany(["snapshot", "local", "jev", "luna", "jevBaseline", "accounts", "translations", "session"]);
  localStorage.removeItem(WILMA_PASSWORD);
  saveSettings();
}

export async function savedSession(): Promise<SavedSession | null> {
  await writes;
  return selectedId ? records.get(selectedId)!.session : null;
}
export function saveSession(session: SavedSession | null, current = () => true): Promise<void> {
  if (session) return accountStore(session.account).saveSession(session, current);
  return selectedId ? accountStore(records.get(selectedId)!.account).saveSession(null, current) : writes;
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
  for (const record of records.values()) record.generation += 1;
  records.clear();
  selectedId = null;
  accountsDirty = false;
  accountGeneration += 1;
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key?.startsWith("wilmai.")) localStorage.removeItem(key);
  }
  // A reset must not import a key from an earlier version on the next launch.
  localStorage.setItem(MOVED_KEY, "1");
  setState({ ...blankCache(), settings: { ...DEFAULT_SETTINGS }, usage: {}, phrases: {}, signedOutReason: null, rejoin: { at: null, failed: null } });
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
