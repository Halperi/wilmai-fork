/** Account engines own their clients, work queues and recovery state. UI helpers default to the selected source. */
import { clearReports } from "../wilma/transport";
import type { AccountInfo } from "./model";
import { accountId, type AccountId } from "./account-id";
import { createAccountEngine, type AccountEngine, type CliAccount } from "./account-engine";
import { accountKey, knownAccounts, selectedAccountId, selectAccount, accountStore, setState, forgetEverything, resetScope, type SavedSession } from "./store";
import { SignInCancelledError } from "./sign-in-attempt";
export { SESSION_CHANGED_NOTE, PasswordRefusedError, SignInAgainError, rejoinPause, type CliAccount } from "./account-engine";

const engines = new Map<AccountId | null, AccountEngine>();
let resetBarrier: Promise<unknown> = Promise.resolve();
let foreground = 0;
function engine(account: AccountInfo | null): AccountEngine {
  const id = account ? accountId(account) : null;
  let instance = engines.get(id);
  if (!instance || !instance.current()) {
    instance?.dispose();
    instance = createAccountEngine(account, () => { if (id) selectAccount(id); });
    engines.set(id, instance);
  }
  return instance;
}
function selected() {
  const id = selectedAccountId();
  return engine(knownAccounts().find((a) => accountKey(a) === id) ?? null);
}
function cancelPending(foregroundOnly = false) { for (const instance of engines.values()) instance.cancelPending(foregroundOnly); }
function dispatch<K extends keyof AccountEngine>(key: K): AccountEngine[K] {
  return ((...args: unknown[]) => (selected()[key] as (...args: unknown[]) => unknown)(...args)) as AccountEngine[K];
}

/** Explicit targeting is also available to the future unified view; no temporary global account switching. */
export function engineFor(account: AccountInfo): AccountEngine { return engine(account); }

export function signInWithPassword(...args: Parameters<AccountEngine["signInWithPassword"]>): ReturnType<AccountEngine["signInWithPassword"]> {
  cancelPending(true);
  const ticket = ++foreground;
  const [baseUrl, username, , saved] = args;
  const account: AccountInfo = saved?.account ?? { baseUrl, username, via: "password", tenantName: null };
  return resetBarrier.then(() => {
    if (ticket !== foreground) throw new SignInCancelledError();
    return engine(account).signInWithPassword(...args);
  });
}
export function signInWithCli(saved: CliAccount, automatic = false): ReturnType<AccountEngine["signInWithCli"]> {
  cancelPending(true);
  const ticket = ++foreground;
  return resetBarrier.then(() => {
    if (ticket !== foreground) throw new SignInCancelledError();
    return engine({ ...saved, via: "cli" }).signInWithCli(saved, automatic);
  });
}
export async function signInDemo() {
  cancelPending();
  const ticket = ++foreground;
  await resetBarrier;
  if (ticket !== foreground) throw new SignInCancelledError();
  return engine({ baseUrl: "", username: "", via: "demo", tenantName: null }).signInDemo();
}
export function signOut() {
  ++foreground;
  cancelPending(true);
  return selected().signOut();
}
export const leaveDemo = signOut;

/** Restore every saved client independently. One expired session cannot end another account. */
export async function resume(saved: SavedSession | null) {
  const generation = resetScope();
  for (const instance of engines.values()) instance.dispose();
  engines.clear();
  const accounts = knownAccounts();
  if (!accounts.length) return selected().resume(saved);
  await Promise.all(accounts.map(async (account) => {
    const store = accountStore(account);
    const own = await store.savedSession();
    if (generation !== resetScope() || !store.current()) return;
    try { await engine(account).resume(own); }
    catch (error) {
      if (generation === resetScope() && store.current()) store.setState({ phase: "signed-out", signedOutReason: error instanceof Error ? error.message : String(error) });
    }
  }));
  if (generation === resetScope() && !selectedAccountId()) setState({ phase: "signed-out" });
}

/** Reset is device-wide: invalidate every owner before waiting for any logout or persistence. */
export function resetApp() {
  ++foreground;
  cancelPending();
  const leaving = [...engines.values()].map((instance) => instance.signOut());
  const previousReset = resetBarrier;
  setState({ phase: "loading" });
  const reset = (async () => {
    try {
      await previousReset;
      await Promise.all(leaving);
      for (const instance of engines.values()) instance.dispose();
      engines.clear();
      await forgetEverything();
      await clearReports();
    } finally { setState({ phase: "signed-out" }); }
  })();
  resetBarrier = reset.catch(() => {});
  return reset;
}

export const cliAccounts = dispatch("cliAccounts");
export const getBack = dispatch("getBack");
export const signInAgain = dispatch("signInAgain");
export const isSessionEnded = dispatch("isSessionEnded");
export const keepAlive = dispatch("keepAlive");
export const withSent = dispatch("withSent");
export const syncNow = dispatch("syncNow");
export const openMessage = dispatch("openMessage");
export const openNews = dispatch("openNews");
export const replyApi = dispatch("replyApi");
export const answerInvitation = dispatch("answerInvitation");
export const declineInvitation = dispatch("declineInvitation");
export const loadGradebook = dispatch("loadGradebook");
export const loadPastExams = dispatch("loadPastExams");
export const loadYearNotes = dispatch("loadYearNotes");
export const loadWeek = dispatch("loadWeek");
export const loadContacts = dispatch("loadContacts");
export const messageApi = dispatch("messageApi");
export const absenceDay = dispatch("absenceDay");
export const prepareAbsenceReport = dispatch("prepareAbsenceReport");
export const sendAbsenceReport = dispatch("sendAbsenceReport");
export const preparedAgain = dispatch("preparedAgain");
export const sessionChangedNote = dispatch("sessionChangedNote");
export const isDemo = dispatch("isDemo");
