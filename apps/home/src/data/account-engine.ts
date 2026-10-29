/*
 * Signing in, keeping the session, and syncing Wilma into the snapshot.
 *
 * Polite to Wilma: at most three requests at a time, details only for what's
 * recent, and nothing re-read that hasn't changed. Unread messages are not
 * opened in the background unless the parent allows it, because opening a
 * message marks it read in Wilma.
 */
import {
  AuthenticationError,
  SessionEndedError,
  WilmaClient,
  addExamTimes,
  type GradebookEntry,
  type PastExam,
  type InvitationListing,
  type LessonNote,
  type Message,
  type MessageRecipient,
  type NewsItem,
  type ScheduleLesson,
} from "@wilma-client/src/core";
import * as write from "@wilma-client/src/write";
import { bridgeCall, isDesktopApp, savedLoginSecret, sharedKeyFor, sharedSessionFor, wilmaTransport } from "../wilma/transport";
import { totpCallback } from "../wilma/totp";
import { recordSession as recordAccountSession, sessionCookieOf } from "./history";
import { addDays, clock, dateOf, daysBetween, mondayOf, today } from "./dates";
import { emptySnapshot, firstName, type AccountInfo, type Child, type Contacts, type MessageRec, type NewsRec, type Snapshot, type Viewer } from "./model";
import { accountKey, accountStore, flushPersisted, selectedAccountId, type SavedSession } from "./store";
import { SignInAttempt, SignInCancelledError, SignInLifecycle } from "./sign-in-attempt";
import { demoContacts, demoSnapshot } from "../demo/demo";
import { runJev as runSelectedJev } from "../jev/runner";
import { runLuna as runSelectedLuna } from "../luna/events";
import { t } from "../i18n";
import { retainedScheduleWeeks } from "./schedule";


/** Wilma refused the credentials; the owning account can forget its remembered password. */
export class PasswordRefusedError extends Error {
  constructor() {
    super(t("Wilma didn't accept that username and password."));
    this.name = "PasswordRefusedError";
  }
}

export class SignInAgainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInAgainError";
  }
}

/** Saved CLI login metadata; list positions are never account identities. */
export interface CliAccount {
  index: number;
  /** The CLI's id for the login (desktop app). */
  id?: string;
  baseUrl: string;
  username: string;
  tenantName: string | null;
  hasTotp?: boolean;
  /** The shared session's key (browser setup). */
  key?: string;
}

export function rejoinPause(lastAutomaticAt: number, now: number, previousPause: number): number {
  const racing = lastAutomaticAt > 0 && now - lastAutomaticAt < RACE_MS;
  return racing ? Math.min(previousPause ? previousPause * 2 : PAUSE_MS, MOST_PAUSE_MS) : 0;
}

const RACE_MS = 15 * 60_000;

const PAUSE_MS = 30 * 60_000;

const MOST_PAUSE_MS = 2 * 3_600_000;

export const SESSION_CHANGED_NOTE = "The Wilma session changed, so nothing was sent. Check it and send again.";

export function createAccountEngine(account: AccountInfo | null, select: () => void) {
  const store = accountStore(account);
  const { getState, setState, accountScope, invalidateAccountScope, activateAccount, savedSession, saveSession, setViewAs, updateSettings } = store;
  let focusOnCommit = false;
  const assertAccount = (value: AccountInfo) => { if (accountKey(value) !== store.id) throw new Error("Wrong account runtime"); };
  const recordSession: typeof recordAccountSession = (event) => recordAccountSession(event, store.id);
  const runJev = () => selectedAccountId() === store.id ? runSelectedJev() : Promise.resolve();
  const runLuna = () => selectedAccountId() === store.id ? runSelectedLuna() : Promise.resolve();
  /** The signed-in Wilma: wilma-client, which never logs in again by itself here (see signIn). */
  let api: { client: WilmaClient; account: AccountInfo; sharedKey?: string; attempt: SignInAttempt } | null = null;
  let syncing: Promise<void> | null = null;
  let endingSession: Promise<unknown> = Promise.resolve();
  const signIns = new SignInLifecycle();

  function invalidateSignIn() {
    signIns.invalidate();
    invalidateAccountScope();
    gettingBack = null;
  }

  function beginSignIn() {
    if (!store.current()) throw new SignInCancelledError();
    invalidateSignIn();
    return signIns.begin();
  }

  /** The client for one child. */
  function kid(number: string): WilmaClient {
    if (!api) throw new SessionEndedError();
    return api.client.forStudent(number);
  }

  /** Keep the session (Wilma's cookies) for the next start. */
  function keepSession() {
    const owner = api;
    if (owner?.attempt.current) saveSession({ account: owner.account, state: owner.client.exportSession(), sharedKey: owner.sharedKey }, () => api === owner && owner.attempt.current);
  }

  /** Client options: this app's transport, never logging in by itself, and WilmAI's shared session when the login's key is known. */
  function clientOptions(sharedKey: string | undefined, attempt: SignInAttempt) {
    const source = sharedKey ? sharedSessionFor(sharedKey) : undefined;
    const shared = source ? {
      get last() { return source.last; },
      entry: () => { attempt.assertCurrent(); return attempt.wait(source.entry()); },
      load: () => { attempt.assertCurrent(); return attempt.wait(source.load()); },
      // The client's login callback runs before the app has accepted this attempt.
      // Publish explicitly at commit; discarded logins must never reach the shared file.
      save: async (state: string) => {
        if (store.current() && attempt.current && attempt.committed) await source.save(state);
      },
    } : undefined;
    const transport: typeof wilmaTransport = (req) => {
      if (attempt.committed) return wilmaTransport(req); // Including logout after local invalidation.
      attempt.assertCurrent();
      return attempt.wait(wilmaTransport(req));
    };
    return { transport, sharedSession: shared };
  }

  /**
   * Note in the sign-in history when the client, finding this app's session
   * ended, continued the one another WilmAI program saved (that program's
   * login is what ended it).
   */
  function watchSession(client: WilmaClient, shared: ReturnType<typeof clientOptions>["sharedSession"], attempt: SignInAttempt) {
    client.onSessionEvent((event) => {
      if (event !== "adopted" || !store.current() || !attempt.current || api?.client !== client) return;
      const last = shared?.last;
      recordSession({ kind: "continued", by: last?.by ?? null, savedAt: last?.savedAt ?? null, midway: true });
      keepSession();
    });
  }

  function limiter(max: number, current = () => true) {
    let active = 0;
    const queue: (() => void)[] = [];
    return async <T>(task: () => Promise<T>): Promise<T> => {
      if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
      active += 1;
      try {
        if (!current()) throw new SessionEndedError();
        return await task();
      } finally {
        active -= 1;
        queue.shift()?.();
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Sessions                                                           */
  /* ------------------------------------------------------------------ */

  /*
   * Wilma allows one live session per account, and every login ends the
   * parent's others (their own Wilma tab, the phone app). So the app logs in
   * only when the parent signs in here, or (Settings, Stay signed in) when the
   * parent has asked it to sign in again by itself. It shares its session with
   * the other WilmAI programs on this computer (the CLI, assistants'
   * connectors) through the CLI's session file: when Wilma ends the app's
   * session, the client first continues one of theirs. Only when no WilmAI
   * session is alive does the sign-in page say so; everything already read
   * stays.
   *
   * While signed out, every check (getBack) first looks for a live session
   * another WilmAI program saved (no login), then, staying signed in, signs in.
   * A session the app signed into by itself that Wilma ends again within
   * minutes means Wilma is in use elsewhere (a browser): the app waits, longer
   * each time, rather than race the parent.
   */

  let lastAutomatic = 0;
  let pause = 0;

  /** Start from what this device remembers: show the cache at once, then refresh. */
  async function resume(saved: SavedSession | null) {
    if (saved) assertAccount(saved.account);
    const attempt = beginSignIn();
    focusOnCommit = false;
    try {
      let snapshot = getState().snapshot;
      if (!snapshot && saved?.state) {
        snapshot = emptySnapshot(saved.account);
        setState({ snapshot });
      }
      if (snapshot?.account.via === "demo") {
        setState({ phase: "ready" });
        void runJev();
        void runLuna();
        return;
      }
      // Browser development: a session from "Continue as" made before sessions were shared learns its login's key.
      if (saved && !saved.sharedKey && saved.account.via === "cli") {
        saved = { ...saved, sharedKey: (await attempt.wait(cliAccounts())).find((a) => accountKey({ ...a, via: "cli" }) === accountKey(saved!.account))?.key };
      }
      // The app's own session, or (when Wilma ended it) the one another WilmAI program saved.
      let state = saved?.state || null;
      const shared = !state && saved?.sharedKey ? await attempt.wait(sharedSessionFor(saved.sharedKey).entry().catch(() => null)) : null;
      state ||= shared?.state ?? null;
      attempt.assertCurrent();
      if (!store.current()) throw new SignInCancelledError();
      const options = clientOptions(saved?.sharedKey, attempt);
      const client = saved && state ? WilmaClient.resumeSession(saved.account.baseUrl, state, options) : null;
      if (!saved || !client || !snapshot) {
        setState({ phase: "signed-out" });
        return;
      }
      if (shared) recordSession({ kind: "continued", by: shared.by, savedAt: shared.savedAt, midway: false });
      attempt.committed = true;
      watchSession(client, options.sharedSession, attempt);
      api = { client, account: saved.account, sharedKey: saved.sharedKey, attempt };
      setState({ phase: "ready" });
      void runJev();
      void runLuna();
      void syncNow();
    } catch (err) {
      if (!(err instanceof SignInCancelledError)) throw err;
    }
  }

  /** What finishing a sign-in notes in the sign-in history. */
  type HistoryEvent = Parameters<typeof recordSession>[0] & { kind: "signed-in" | "continued" };

  async function finishSignIn(
    attempt: SignInAttempt,
    account: AccountInfo,
    client: WilmaClient,
    sharedKey: string | undefined,
    event: HistoryEvent,
    known?: { studentNumber: string; name: string; role?: Viewer }[],
    /** Who signed in, as chosen on the sign-in page: it decides over Wilma's role (viewerOf). */
    viewAs?: Viewer,
    onCommit?: () => void
  ) {
    attempt.assertCurrent();
    assertAccount(account);
    if (!store.current()) throw new SignInCancelledError();
    const students = known ?? await attempt.wait(client.students());
    attempt.assertCurrent();
    if (!store.current()) throw new SignInCancelledError();
    // No await between the final check and publishing the accepted account.
    const shared = clientOptions(sharedKey, attempt).sharedSession;
    attempt.committed = true;
    client.useSharedSession(shared);
    watchSession(client, shared, attempt);
    api = { client, account, sharedKey, attempt };
    if (accountKey(getState().snapshot?.account) !== accountKey(account)) activateAccount(account);
    if (viewAs) setViewAs(viewAs);
    onCommit?.();
    const snapshot: Snapshot = getState().snapshot ? { ...getState().snapshot!, account } : emptySnapshot(account);
    snapshot.children = toChildren(students);
    // A student's own login reads as a student; the choice in Settings still wins (viewerOf).
    const wilmaRole = roleOf(students) ?? snapshot.account.wilmaRole;
    if (wilmaRole) {
      snapshot.account = { ...snapshot.account, wilmaRole };
      api.account = snapshot.account;
    }
    recordSession(event);
    keepSession();
    void shared?.save(client.exportSession()).catch(() => {});
    setState({ snapshot, phase: "ready", signedOutReason: null });
    if (focusOnCommit) { focusOnCommit = false; select(); }
    await attempt.wait(syncNow());
  }

  function signInError(err: unknown): Error {
    if (err instanceof AuthenticationError && /OTP|MFA/i.test(err.message)) return new Error(t("Wilma didn't accept that code. Check the code in your authenticator app."));
    if (err instanceof AuthenticationError) return new PasswordRefusedError();
    return err instanceof Error ? err : new Error(String(err));
  }

  /**
   * Log in with the parent's username and password. When Wilma asks for a
   * two-step code, returns `mfa` for the code the parent types; a refused code
   * can be typed again once (Wilma's own limit for one login). A saved login
   * (`saved`) answers the code itself when it has the authenticator key.
   */
  async function signInWithPassword(
    baseUrl: string,
    username: string,
    password: string,
    saved?: { account: AccountInfo; totpSecret: string | null },
    automatic = false,
    viewAs?: Viewer,
    rememberPassword?: boolean
  ): Promise<{ mfa: (code: string) => Promise<void> } | null> {
    assertAccount({ baseUrl, username, via: "password", tenantName: null });
    if (saved) assertAccount(saved.account);
    const attempt = beginSignIn();
    focusOnCommit = !automatic;
    if (!automatic) manualSignIn();
    try {
      return await attempt.wait(signInPassword(attempt, baseUrl, username, password, saved, automatic, viewAs, rememberPassword));
    } catch (err) {
      // Forget a refused remembered password here, while its attempt is still known.
      // A UI continuation must never clear a newer account's credentials.
      const known = getState().snapshot?.account;
      if (err instanceof PasswordRefusedError && attempt.current && known &&
          accountKey(known) === accountKey({ baseUrl, username, via: "password", tenantName: null }) && getState().settings.wilmaPassword === password) {
        updateSettings({ wilmaPassword: "", staySignedIn: false });
      }
      throw err;
    }
  }

  /** Nested recovery paths and MFA keep the original attempt rather than starting a new one. */
  async function signInPassword(
    attempt: SignInAttempt,
    baseUrl: string,
    username: string,
    password: string,
    saved?: { account: AccountInfo; totpSecret: string | null },
    automatic = false,
    viewAs?: Viewer,
    rememberPassword?: boolean
  ): Promise<{ mfa: (code: string) => Promise<void> } | null> {
    await attempt.wait(endingSession);
    const account: AccountInfo = saved?.account ?? { baseUrl: baseUrl.replace(/\/$/, ""), username, tenantName: null, via: "password" };
    const event: HistoryEvent = { kind: "signed-in", how: automatic ? "automatic" : saved ? "saved-login" : "password" };
    // The CLI's key for this login: the app and the other WilmAI programs then share one session.
    const sharedKey = await attempt.wait(sharedKeyFor(account.baseUrl, username, password));
    const options = { ...clientOptions(sharedKey, attempt), relogin: false };
    const remember = () => {
      attempt.assertCurrent();
      if (rememberPassword !== undefined) updateSettings(rememberPassword
        ? { rememberPassword: true, wilmaPassword: password }
        : { rememberPassword: false, wilmaPassword: "", staySignedIn: false });
    };
    if (saved?.totpSecret) {
      const code = totpCallback(saved.totpSecret);
      const client = await attempt.wait(WilmaClient.login({ baseUrl: account.baseUrl, username, password }, (formkey) => {
        attempt.assertCurrent();
        return attempt.wait(code(formkey));
      }, options)).catch((err) => {
        throw signInError(err);
      });
      await finishSignIn(attempt, account, client, sharedKey, event, undefined, viewAs, remember);
      return null;
    }
    let giveCode: ((code: string) => void) | null = null;
    let codeAsked: () => void = () => {};
    let asked = new Promise<void>((resolve) => (codeAsked = resolve));
    const onMfa = () => {
      attempt.assertCurrent();
      return attempt.wait(new Promise<string>((resolve) => {
        giveCode = resolve;
        codeAsked();
      }));
    };
    const login = attempt.wait(WilmaClient.login({ baseUrl: account.baseUrl, username, password }, onMfa, options));
    const first = await attempt.wait(Promise.race([login, asked.then(() => null)])).catch((err) => {
      throw signInError(err);
    });
    if (first) {
      await finishSignIn(attempt, account, first, sharedKey, event, undefined, viewAs, remember);
      return null;
    }
    // When the code dialog is abandoned, its background login still needs a rejection handler.
    void login.catch(() => {});
    return {
      mfa: async (code: string) => {
        attempt.assertCurrent();
        asked = new Promise<void>((resolve) => (codeAsked = resolve));
        giveCode?.(code.trim());
        // Either the login finishes, or Wilma refused the code and asks again.
        const client = await attempt.wait(Promise.race([login, asked.then(() => null)])).catch((err) => {
          if (err instanceof SignInCancelledError) throw err;
          throw new SignInAgainError(t("{error} Sign in again with your password.", { error: signInError(err).message }));
        });
        if (!client) throw new Error(t("Wilma didn't accept that code. Type the newest code from your authenticator app."));
        await finishSignIn(attempt, account, client, sharedKey, event, undefined, viewAs, remember);
      },
    };
  }

  async function cliAccounts(): Promise<CliAccount[]> {
    try {
      return (await bridgeCall<{ accounts: CliAccount[] }>("cli/accounts")).accounts;
    } catch {
      return [];
    }
  }

  /**
   * One click with the CLI's saved login. First a live session another WilmAI
   * program saved (no login, so Wilma on the phone stays signed in too), and
   * only when there is none, a login with the saved password (and code, when
   * the CLI keeps the authenticator key). Returns `mfa` when Wilma asks for a
   * code the saved login can't make.
   */
  async function signInWithCli(saved: CliAccount, automatic = false): Promise<{ mfa: (code: string) => Promise<void> } | null> {
    assertAccount({ ...saved, via: "cli" });
    const attempt = beginSignIn();
    focusOnCommit = !automatic;
    if (!automatic) manualSignIn();
    return attempt.wait(signInCli(attempt, saved, automatic));
  }

  async function signInCli(attempt: SignInAttempt, saved: CliAccount, automatic = false): Promise<{ mfa: (code: string) => Promise<void> } | null> {
    await attempt.wait(endingSession);
    const account: AccountInfo = { baseUrl: saved.baseUrl.replace(/\/$/, ""), username: saved.username, tenantName: saved.tenantName, via: "cli", cliIndex: saved.index };
    if (!isDesktopApp) return signInThroughBridge(attempt, account, saved.index);
    const secret = await attempt.wait(savedLoginSecret(saved.id ?? "")).catch((err) => {
      if (err instanceof SignInCancelledError) throw err;
      throw new Error(t(err instanceof Error ? err.message : String(err)));
    });
    const sharedKey = await attempt.wait(sharedKeyFor(account.baseUrl, account.username, secret.password));
    const entry = await attempt.wait(sharedSessionFor(sharedKey).entry().catch(() => null));
    const client = entry ? WilmaClient.resumeSession(account.baseUrl, entry.state, clientOptions(sharedKey, attempt)) : null;
    if (entry && client) {
      try {
        const students = await attempt.wait(client.students());
        await finishSignIn(attempt, account, client, sharedKey, { kind: "continued", by: entry.by, savedAt: entry.savedAt, midway: false }, students);
        return null;
      } catch (err) {
        // Ended too: sign in below. Anything else (Wilma unreachable) is for the parent to see.
        if (!(err instanceof SessionEndedError)) throw err;
      }
    }
    return signInPassword(attempt, account.baseUrl, account.username, secret.password, { account, totpSecret: secret.totpSecret }, automatic);
  }

  /** The parent signed in: staying signed in starts over (no pause, nothing failed). */
  function manualSignIn() {
    pause = 0;
    lastAutomatic = 0;
    setState({ rejoin: { at: null, failed: null } });
  }

  let gettingBack: Promise<boolean> | null = null;

  /**
   * While signed out (the background check, every ten minutes): back into Wilma without the parent, if there's a way.
   * First a live session another WilmAI program saved on this computer (no login); then, staying signed in and not
   * pausing, a login of the app's own (the CLI's saved login, or the kept password). Wilma asking for a two-step code
   * the app can't give, or refusing the login, ends trying until the parent signs in. True when back in.
   */
  function getBack(): Promise<boolean> {
    if (gettingBack) return gettingBack;
    const { phase, snapshot, settings, rejoin } = getState();
    if (phase !== "signed-out" || !snapshot || snapshot.account.via === "demo") return Promise.resolve(false);
    const attempt = beginSignIn();
    focusOnCommit = false;
    const recovery = (async () => {
      try {
        const saved = await attempt.wait(savedSession());
        if (!saved) return false;
        // 1. Another WilmAI program's live session: continue it.
        if (saved.sharedKey) {
          const entry = await attempt.wait(sharedSessionFor(saved.sharedKey).entry().catch(() => null));
          const client = entry ? WilmaClient.resumeSession(saved.account.baseUrl, entry.state, clientOptions(saved.sharedKey, attempt)) : null;
          if (entry && client) {
            try {
              const students = await attempt.wait(client.students());
              await finishSignIn(attempt, saved.account, client, saved.sharedKey, { kind: "continued", by: entry.by, savedAt: entry.savedAt, midway: false }, students);
              return true;
            } catch (err) {
              if (!(err instanceof SessionEndedError)) return false; // Wilma unreachable: the next check tries again
            }
          }
        }
        // 2. Staying signed in: the app's own login, unless it's pausing or failed.
        if (!settings.staySignedIn || rejoin.failed || (rejoin.at && Date.now() < rejoin.at)) return false;
        try {
          let needsCode: Awaited<ReturnType<typeof signInPassword>> = null;
          if (saved.account.via === "cli") {
            const login = (await attempt.wait(cliAccounts())).find((a) => accountKey({ ...a, via: "cli" }) === accountKey(saved.account));
            if (!login) throw new Error(t("The WilmAI CLI's saved login isn't on this computer any more."));
            needsCode = await signInCli(attempt, login, true);
          } else if (settings.wilmaPassword) {
            needsCode = await signInPassword(attempt, saved.account.baseUrl, saved.account.username, settings.wilmaPassword, undefined, true);
          } else return false;
          if (needsCode) {
            attempt.cancel(); // No dialog is being shown to answer this challenge.
            throw new Error(t("Wilma asked for a two-step code."));
          }
          lastAutomatic = Date.now();
          setState({ rejoin: { at: null, failed: null } });
          return true;
        } catch (err) {
          if (err instanceof SignInCancelledError) return false;
          const why = err instanceof Error ? err.message : String(err);
          setState({ phase: "signed-out", rejoin: { at: null, failed: why }, signedOutReason: t("Wilma ended the session, and signing in again didn't work: {why}", { why }) });
          return false;
        }
      } catch (err) {
        if (err instanceof SignInCancelledError) return false;
        throw err;
      }
    })().finally(() => {
      if (gettingBack === recovery) gettingBack = null;
    });
    return gettingBack = recovery;
  }

  /** Browser development: the bridge continues or makes the CLI's session itself and hands it over. */
  async function signInThroughBridge(attempt: SignInAttempt, account: AccountInfo, index: number): Promise<null> {
    const data = await attempt.wait(bridgeCall<{
      baseUrl: string;
      username: string;
      tenantName: string | null;
      students: { studentNumber: string; name: string }[];
      state: string;
      key: string;
      continued: { savedAt: number | null; by: string | null } | null;
    }>("cli/session", { body: { index, baseUrl: account.baseUrl, username: account.username } }));
    assertAccount({ ...account, baseUrl: data.baseUrl, username: data.username });
    const client = WilmaClient.resumeSession(account.baseUrl, data.state, clientOptions(data.key, attempt));
    if (!client) throw new Error(t("The CLI's login has no Wilma session."));
    const event: HistoryEvent = data.continued ? { kind: "continued", ...data.continued, midway: false } : { kind: "signed-in", how: "saved-login" };
    await finishSignIn(attempt, { ...account, tenantName: data.tenantName ?? account.tenantName }, client, data.key, event, data.students);
    return null;
  }

  async function signInDemo() {
    invalidateSignIn();
    api = null;
    const demo = demoSnapshot();
    activateAccount(demo.account);
    updateSettings({ staySignedIn: false, wilmaPassword: "" });
    setState({ snapshot: getState().snapshot ?? demo, phase: "ready" });
    select();
    await saveSession(null);
    await flushPersisted();
    void runJev();
    void runLuna();
  }

  /** Back to sign-in with each family's data and AI answers kept separately. */
  function leaveDemo() {
    return signOut();
  }

  async function signOut() {
    invalidateSignIn();
    const previous = api;
    api = null;
    const ending = previous?.client.logout().catch(() => {}) ?? endingSession;
    endingSession = ending;
    activateAccount(null);
    updateSettings({ staySignedIn: false, wilmaPassword: "" });
    setState({ phase: "signed-out" });
    await saveSession(null); // Deliberate sign-out must never automatically rejoin.
    await flushPersisted();
    await ending;
  }

  /** Logins whose role was asked for in this run. */
  const roleAsked = new Set<string>();

  /** Whose login it is: a student's own when Wilma lists only the student themself, a guardian's when it says so. */
  function roleOf(students: { role?: Viewer }[]): Viewer | undefined {
    if (students.length && students.every((s) => s.role === "student")) return "student";
    return students.some((s) => s.role === "guardian") ? "guardian" : undefined;
  }

  function toChildren(students: { studentNumber: string; name: string }[]): Child[] {
    return students.map((s, i) => ({ number: s.studentNumber, name: s.name, first: firstName(s.name), color: i }));
  }

  function handleError(err: unknown, scope = accountScope()) {
    if (scope !== accountScope() || err instanceof SignInCancelledError) return;
    if (err instanceof SessionEndedError || err instanceof AuthenticationError) {
      if (api) void recordEnd(api.client.exportSession(), api.sharedKey);
      // Keep the login's shared key: the next start continues a session another WilmAI program saved meanwhile.
      saveSession(api?.sharedKey ? { account: api.account, state: "", sharedKey: api.sharedKey } : null);
      api = null;
      const { settings, rejoin } = getState();
      if (settings.staySignedIn && !rejoin.failed) {
        // Ended soon after the app's own sign-in: Wilma is in use elsewhere (a browser). Wait, longer each time; else at once.
        pause = rejoinPause(lastAutomatic, Date.now(), pause);
        const at = pause ? Date.now() + pause : null;
        setState({
          phase: "signed-out",
          rejoin: { at, failed: null },
          signedOutReason: at
            ? t("Wilma ended the session again soon after: it seems to be in use elsewhere. The app signs in again at {time}.", { time: clock(new Date(at)) })
            : t("Wilma ended the session. Signing in again…"),
        });
        if (!at) void getBack();
        return;
      }
      setState({ phase: "signed-out", signedOutReason: t("Wilma ended the session. Sign in again to refresh; everything already here stays.") });
      return;
    }
    setState((s) => ({ sync: { ...s.sync, running: false, step: null, error: err instanceof Error ? err.message : String(err) } }));
  }

  /**
   * The sign-in history's note on an ended session: whether another WilmAI
   * program's login (saved in the shared file, a different session from this
   * app's) is what ended it, or none did, which leaves Wilma on a phone or in
   * a browser, or Wilma's own time limit.
   */
  async function recordEnd(ourState: string, sharedKey: string | undefined) {
    const scope = accountScope();
    const entry = sharedKey ? await sharedSessionFor(sharedKey).entry().catch(() => null) : null;
    if (scope !== accountScope()) return;
    // A session this app saved itself isn't another program's login (its cookie may since have been renewed).
    const other = Boolean(entry && entry.by !== "home" && sessionCookieOf(entry.state) && sessionCookieOf(entry.state) !== sessionCookieOf(ourState));
    recordSession({
      kind: "ended",
      other,
      by: other ? (entry?.by ?? null) : null,
      savedAt: other ? (entry?.savedAt ?? null) : null,
      lastOk: getState().sync.lastOk,
    });
  }

  /**
   * Wilma ended the session while the parent was doing something (writing a
   * message): note it in the history and show the sign-in page, where the
   * saved login is one click. The route stays, so the parent comes back to
   * the same screen, and drafts are kept on this device.
   */
  function signInAgain(): void {
    handleError(new SessionEndedError());
  }

  const isSessionEnded = (err: unknown): boolean => err instanceof SessionEndedError;

  /**
   * Keep the session alive while the app is open but out of sight (Wilma ends
   * idle sessions; the app refreshes every ten minutes only while it shows).
   * One small read; never a login. A session found ended goes the usual way.
   */
  async function keepAlive(): Promise<void> {
    if (!api || syncing) return;
    const scope = accountScope();
    try {
      await api.client.students();
    } catch (err) {
      if (scope === accountScope() && (err instanceof SessionEndedError || err instanceof AuthenticationError)) handleError(err);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Sync                                                               */
  /* ------------------------------------------------------------------ */

  function patchSnapshot(update: (snap: Snapshot) => Snapshot, scope = accountScope()) {
    if (scope !== accountScope()) return;
    const snap = getState().snapshot;
    if (snap) setState({ snapshot: update(snap) });
  }

  /** Children in the family's order (not in the order a sync happened to read them). */
  function inFamilyOrder(numbers: string[]): string[] {
    const family = getState().snapshot?.children.map((c) => c.number) ?? [];
    const rank = (n: string) => (family.includes(n) ? family.indexOf(n) : family.length);
    return [...new Set(numbers)].sort((a, b) => rank(a) - rank(b));
  }

  function mergeMessages(current: Record<number, MessageRec>, lists: [string, Message[]][]): Record<number, MessageRec> {
    const next: Record<number, MessageRec> = {};
    for (const [child, list] of lists) {
      for (const m of list) {
        const before = next[m.wilmaId] ?? current[m.wilmaId];
        const replyCount = m.replyCount ?? 0;
        next[m.wilmaId] = {
          id: m.wilmaId,
          subject: m.subject,
          sender: m.senderName ?? null,
          sentAt: m.sentAt,
          unreadInWilma: Boolean(m.unread),
          replyCount,
          children: inFamilyOrder([...(next[m.wilmaId]?.children ?? []), child]),
          // A new reply means the thread must be read again.
          thread: before?.thread && before.replyCount === replyCount ? before.thread : undefined,
        };
      }
    }
    return next;
  }

  /**
   * Adds what the family sent, from Wilma's Sent folder. A thread someone answered is in the inbox too, and the inbox's
   * listing wins (its sender is the family, data/feed.ts).
   */
  function withSent(next: Record<number, MessageRec>, before: Record<number, MessageRec>, lists: [string, Message[]][]): Record<number, MessageRec> {
    for (const [child, list] of lists) {
      for (const m of list) {
        const listed = next[m.wilmaId];
        if (listed && !listed.sent) continue;
        const was = listed ?? before[m.wilmaId];
        const replyCount = m.replyCount ?? 0;
        next[m.wilmaId] = {
          id: m.wilmaId,
          subject: m.subject,
          // Who the Sent folder names isn't the sender; the thread says who it went to.
          sender: null,
          sentAt: m.sentAt,
          unreadInWilma: false,
          replyCount,
          children: inFamilyOrder([...(listed?.children ?? []), child]),
          thread: was?.thread && was.replyCount === replyCount ? was.thread : undefined,
          sent: true,
        };
      }
    }
    return next;
  }

  /** Wilma's Sent folder read again after a message goes, so it shows at once, with its text. */
  async function loadSent(child: string) {
    const scope = accountScope();
    const sent = await kid(child).messages.list("outbox");
    if (scope !== accountScope()) return;
    patchSnapshot((s) => ({ ...s, messages: withSent({ ...s.messages }, s.messages, [[child, sent]]) }), scope);
    const unread = sent.filter((m) => !getState().snapshot?.messages[m.wilmaId]?.thread).slice(0, 3);
    await Promise.all(unread.map((m) => loadThread(m.wilmaId)));
  }

  /** Marks invitations, and reads one again when its sign-up state changed in Wilma. */
  function withInvites(next: Record<number, MessageRec>, before: Record<number, MessageRec>, lists: [string, InvitationListing[]][]): Record<number, MessageRec> {
    for (const [, list] of lists) {
      for (const { message, status, extra } of list) {
        const rec = next[message.wilmaId];
        if (!rec) continue;
        const changed = before[message.wilmaId]?.invite?.status !== status;
        next[message.wilmaId] = { ...rec, invite: { status, extra }, thread: changed ? undefined : rec.thread };
      }
    }
    return next;
  }

  function mergeNews(current: Record<number, NewsRec>, lists: [string, NewsItem[]][]): Record<number, NewsRec> {
    const next: Record<number, NewsRec> = {};
    for (const [child, list] of lists) {
      for (const n of list) {
        const before = next[n.wilmaId] ?? current[n.wilmaId];
        next[n.wilmaId] = {
          id: n.wilmaId,
          title: n.title,
          subtitle: n.subtitle ?? null,
          author: n.author ?? null,
          published: n.published ?? null,
          pinned: Boolean(n.pinned),
          children: inFamilyOrder([...(next[n.wilmaId]?.children ?? []), child]),
          // Text read by an older wilma-client (bulletins kept the page's raw layout before 2) is read again.
          detail: before?.detail?.v === NEWS_TEXT_V ? before.detail : undefined,
        };
      }
    }
    return next;
  }

  function syncNow(): Promise<void> {
    if (!api) return Promise.resolve();
    const scope = accountScope();
    syncing ??= runSync().finally(() => {
      syncing = null;
      if (scope !== accountScope() && api) void syncNow();
    });
    return syncing;
  }

  async function runSync() {
    const scope = accountScope();
    const client = api?.client;
    const current = () => scope === accountScope() && Boolean(api);
    const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
    const snap = getState().snapshot;
    if (!snap || !client) return;
    const step = (text: string) => current() && setState((s) => ({ sync: { ...s.sync, running: true, step: text, error: null } }));
    step(t("Checking Wilma"));
    const limit = limiter(3, current);
    const now = today();
    const monday = mondayOf(now);
    try {
      if (!snap.children.length || (!snap.account.wilmaRole && !roleAsked.has(snap.account.username))) {
        // An installation from before the role was read learns it here, once per run (Wilmas without the roles API never say).
        roleAsked.add(snap.account.username);
        const students = await client.students();
        const wilmaRole = roleOf(students);
        patch((s) => ({ ...s, children: s.children.length ? s.children : toChildren(students), account: wilmaRole ? { ...s.account, wilmaRole } : s.account }));
      }
      if (!current()) return;
      const children = getState().snapshot!.children;
      const messageLists: [string, Message[]][] = [];
      const sentLists: [string, Message[]][] = [];
      const newsLists: [string, NewsItem[]][] = [];
      const inviteLists: [string, InvitationListing[]][] = [];

      await Promise.all(
        children.map(async (child) => {
          const c = kid(child.number);
          const overview = await limit(() => c.overview.get());
          const [lessons, messages, sent, news, notes, calendar, invites] = await Promise.all([
            limit(() => c.schedule.list({ from: monday, to: addDays(monday, 13) })),
            limit(() => c.messages.list("inbox")),
            // What the family sent and nobody has answered yet is only in the Sent folder.
            limit(() => c.messages.list("outbox")),
            limit(() => c.news.list()),
            // The weeks ahead too: a teacher may note a make-up exam on a coming lesson (for the calendar).
            limit(() => c.attendance.list({ from: addDays(now, -20), to: addDays(now, 60) })),
            // Start times are a bonus; upcoming exams themselves come with the overview.
            limit(() => c.exams.calendarOrEmpty()),
            limit(() => c.invitations.list().catch((err) => (err instanceof SessionEndedError ? Promise.reject(err) : []))),
          ]);
          const exams = addExamTimes(overview.upcomingExams, calendar);
          // The class, once a week (one page): the readers tell an "8. lk" event from the child's own by it.
          const known = getState().snapshot?.perChild[child.number]?.className;
          const className =
            known && Date.now() - new Date(known.fetchedAt).getTime() < 7 * 86_400_000
              ? known
              : await limit(() => c.student.get())
                  .then((details) => ({ value: details.className, fetchedAt: new Date() }))
                  .catch((err) => (err instanceof SessionEndedError ? Promise.reject(err) : known));
          messageLists.push([child.number, messages], [child.number, invites.map((i) => i.message)]);
          sentLists.push([child.number, sent]);
          newsLists.push([child.number, news]);
          inviteLists.push([child.number, invites]);
          patch((s) => ({
            ...s,
            // What the views read when shown (past exams, the grade book, other weeks, the year's notes, contacts) stays.
            perChild: { ...s.perChild, [child.number]: { ...s.perChild[child.number], overview, lessons, notes, exams, className, weeks: retainedScheduleWeeks(s.perChild[child.number], new Date()), syncedAt: new Date() } },
          }));
          step(t("Read {name}'s Wilma", { name: child.first }));
        })
      );

      if (!current()) return;
      patch((s) => ({
        ...s,
        messages: withInvites(withSent(mergeMessages(s.messages, messageLists), s.messages, sentLists), s.messages, inviteLists),
        news: mergeNews(s.news, newsLists),
        firstSyncAt: s.firstSyncAt ?? Date.now(),
      }));

      // Details: recent bulletins, and messages Wilma already shows as read (or all, if allowed).
      const s = getState().snapshot!;
      const allowUnread = getState().settings.backgroundRead;
      const news = Object.values(s.news)
        .filter((n) => !n.detail && (n.pinned || (n.published && daysBetween(dateOf(n.published), now) <= 45)))
        .sort((a, b) => (b.published?.getTime() ?? 0) - (a.published?.getTime() ?? 0))
        .slice(0, 20);
      // A thread read before its opening message's own time was kept is read once more, for that time.
      const messages = Object.values(s.messages)
        .filter((m) => (!m.thread || (m.thread.replies.length > 0 && !m.thread.sentAt)) && (allowUnread || !m.unreadInWilma) && daysBetween(dateOf(m.sentAt), now) <= 120)
        .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
        .slice(0, 30);
      if (news.length || messages.length) step(t("Reading new messages and bulletins"));
      // One that doesn't load (a slow or busy network) doesn't fail the check: it's tried again next time. None loading is worth saying.
      const failed: unknown[] = [];
      const detail = (load: () => Promise<void>) =>
        limit(load).catch((err) => {
          if (err instanceof SessionEndedError || err instanceof AuthenticationError) throw err;
          failed.push(err);
        });
      await Promise.all([...news.map((n) => detail(() => loadNews(n.id))), ...messages.map((m) => detail(() => loadThread(m.id)))]);
      if (failed.length && failed.length === news.length + messages.length) throw failed[0];

      if (!current()) return;
      keepSession();
      patch((x) => ({ ...x, syncedAt: new Date() }));
      setState({ sync: { running: false, step: null, error: null, lastOk: Date.now() } });
    } catch (err) {
      if (current()) handleError(err);
    }
    if (!current()) return;
    void runJev();
    void runLuna();
  }

  async function loadThread(id: number) {
    const scope = accountScope();
    const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
    const rec = getState().snapshot?.messages[id];
    if (!rec) return;
    const message = await kid(rec.children[0]).messages.get(id);
    patch((s) => {
      const current = s.messages[id];
      if (!current) return s;
      return {
        ...s,
        messages: {
          ...s.messages,
          [id]: {
            ...current,
            unreadInWilma: false,
            replyCount: message.replies?.length ?? current.replyCount,
            thread: {
              content: message.content ?? "",
              sentAt: message.sentAt,
              recipients: message.recipients ?? null,
              replies: (message.replies ?? []).map((r) => ({ id: r.id, sentAt: r.sentAt, senderName: r.senderName, content: r.content })),
              collated: Boolean(message.discussion),
              invite: message.invitation ?? null,
              fetchedAt: new Date(),
            },
          },
        },
      };
    });
  }

  /** How bulletin text is read: 2 = as text with its paragraphs and lists (wilma-client's htmlToText). */
  const NEWS_TEXT_V = 2;

  async function loadNews(id: number) {
    const scope = accountScope();
    const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
    const rec = getState().snapshot?.news[id];
    if (!rec) return;
    const item = await kid(rec.children[0]).news.get(id);
    patch((s) => {
      const current = s.news[id];
      if (!current) return s;
      return {
        ...s,
        news: {
          ...s.news,
          [id]: {
            ...current,
            author: current.author ?? item.author ?? null,
            published: current.published ?? item.published ?? null,
            detail: { content: item.content ?? "", resources: item.resources, fetchedAt: new Date(), v: NEWS_TEXT_V },
          },
        },
      };
    });
  }

  /** Open a message in the app: reads it from Wilma when its text isn't here yet (Wilma then shows it as read). */
  async function openMessage(id: number) {
    const scope = accountScope();
    const rec = getState().snapshot?.messages[id];
    if (!rec || rec.thread || !api) return;
    try {
      await loadThread(id);
      void runJev();
      void runLuna();
    } catch (err) {
      handleError(err, scope);
    }
  }

  async function openNews(id: number) {
    const scope = accountScope();
    const rec = getState().snapshot?.news[id];
    if (!rec || rec.detail || !api) return;
    try {
      await loadNews(id);
      void runJev();
      void runLuna();
    } catch (err) {
      handleError(err, scope);
    }
  }

  function replyApi(messageId: number) {
    const rec = getState().snapshot?.messages[messageId];
    if (!rec || !api) return null;
    const child = kid(rec.children[0]);
    return {
      prepare: () => write.prepareReply(child, messageId),
      send: async (form: write.ReplyForm, text: string) => {
        await write.sendReply(child, form, text);
        await loadThread(messageId);
      },
    };
  }

  /** Sign up for, or cancel, one slot of an invitation. wilma-client reads the invitation back to confirm. */
  async function answerInvitation(messageId: number, slotId: string, action: "apply" | "cancel"): Promise<string> {
    const scope = accountScope();
    const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
    const snap = getState().snapshot;
    const rec = snap?.messages[messageId];
    if (!snap || !rec?.thread?.invite) throw new Error(t("Open the invitation first."));
    if (snap.account.via === "demo") {
      const slots = rec.thread.invite.slots.map((slot) => ({
        ...slot,
        selected: action === "apply" ? slot.id === slotId : slot.id === slotId ? false : slot.selected,
        peopleCount: slot.id === slotId ? slot.peopleCount + (action === "apply" ? 1 : -1) : slot.peopleCount,
      }));
      patch((s) => ({
        ...s,
        messages: { ...s.messages, [messageId]: { ...rec, invite: { status: action === "apply" ? "Applied" : null, extra: null }, thread: { ...rec.thread!, invite: { ...rec.thread!.invite!, slots } } } },
      }));
      return action === "apply" ? t("Sample family: signed up here only.") : t("Sample family: cancelled here only.");
    }
    try {
      const { notice } = await write.answerInvitation(kid(rec.children[0]), messageId, slotId, action);
      return notice;
    } finally {
      // Whatever happened, show the invitation as Wilma has it now.
      await loadThread(messageId).catch(() => undefined);
    }
  }

  /** Tell Wilma the family won't attend ("En osallistu"), or take that back. wilma-client reads the invitation back to confirm. */
  async function declineInvitation(messageId: number, undo = false): Promise<string> {
    const scope = accountScope();
    const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
    const snap = getState().snapshot;
    const rec = snap?.messages[messageId];
    if (!snap || !rec?.thread?.invite) throw new Error(t("Open the invitation first."));
    if (snap.account.via === "demo") {
      const invite = rec.thread.invite;
      const slots = invite.slots.map((slot) => ({
        ...slot,
        declined: slot.canDecline && !undo,
        // Declining cancels a sign-up, as in Wilma.
        ...(undo || !slot.selected ? {} : { selected: false, wilmaState: "available", peopleCount: slot.peopleCount - 1 }),
      }));
      patch((s) => ({
        ...s,
        messages: { ...s.messages, [messageId]: { ...rec, invite: { status: null, extra: null }, thread: { ...rec.thread!, invite: { ...invite, slots, declined: !undo } } } },
      }));
      return undo ? t("Sample family: taken back here only.") : t("Sample family: answered here only.");
    }
    try {
      const { notice } = await write.declineInvitation(kid(rec.children[0]), messageId, { undo });
      return notice;
    } finally {
      await loadThread(messageId).catch(() => undefined);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Other weeks                                                        */
  /* ------------------------------------------------------------------ */

  /** Wilma's grade book for one child (Suoritukset: subject > course), read when the Grades view shows it, kept twelve hours. */
  async function loadGradebook(child: string): Promise<GradebookEntry[]> {
    const scope = accountScope();
    const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
    const data = getState().snapshot?.perChild[child];
    const kept = data?.gradebook;
    if (kept && Date.now() - new Date(kept.fetchedAt).getTime() < 12 * 3_600_000) return kept.entries;
    if (isDemo()) return kept?.entries ?? [];
    try {
      const entries = await kid(child).gradebook.get();
      patch((s) => {
        const d = s.perChild[child] ?? { lessons: [], notes: [], exams: [] };
        return { ...s, perChild: { ...s.perChild, [child]: { ...d, gradebook: { entries, fetchedAt: new Date() } } } };
      });
      return entries;
    } catch (err) {
      if (scope === accountScope() && err instanceof SessionEndedError) handleError(err);
      throw err;
    }
  }

  /** Kept past exams read by an older parser are read again (2: exams without a name). */
  const PAST_EXAMS_V = 2;

  /**
   * One child's past exams with grades, from Wilma's past-exams list reaching
   * back nine school years (as far as the school keeps them; one request),
   * read when the Grades view shows them and kept six hours. The front page's
   * newest grades fill in between (see examResults).
   */
  async function loadPastExams(child: string): Promise<PastExam[]> {
    const scope = accountScope();
    const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
    const data = getState().snapshot?.perChild[child];
    const kept = data?.pastExams;
    if (kept && kept.v === PAST_EXAMS_V && Date.now() - new Date(kept.fetchedAt).getTime() < 6 * 3_600_000) return kept.exams;
    if (isDemo()) return kept?.exams ?? [];
    const now = today();
    const year = Number(now.slice(0, 4)) - (Number(now.slice(5, 7)) >= 8 ? 0 : 1);
    try {
      const exams = await kid(child).exams.past({ from: `${year - 8}-08-01`, to: now });
      patch((s) => {
        const d = s.perChild[child] ?? { lessons: [], notes: [], exams: [] };
        return { ...s, perChild: { ...s.perChild, [child]: { ...d, pastExams: { exams, fetchedAt: new Date(), v: PAST_EXAMS_V } } } };
      });
      // Jev reads the marks it hasn't read yet (what each is: a grade, points, another scale…).
      if (scope === accountScope()) void runJev();
      return exams;
    } catch (err) {
      if (scope === accountScope() && err instanceof SessionEndedError) handleError(err);
      throw err;
    }
  }

  /** The whole school year's lesson notes for one child (one request, Wilma's "whole year" view), kept six hours. */
  async function loadYearNotes(child: string): Promise<LessonNote[]> {
    const scope = accountScope();
    const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
    const data = getState().snapshot?.perChild[child];
    const kept = data?.yearNotes;
    if (kept && Date.now() - new Date(kept.fetchedAt).getTime() < 6 * 3_600_000) return kept.notes;
    if (isDemo()) return data?.notes ?? [];
    try {
      const notes = await kid(child).attendance.schoolYear();
      patch((s) => {
        const d = s.perChild[child] ?? { lessons: [], notes: [], exams: [] };
        return { ...s, perChild: { ...s.perChild, [child]: { ...d, yearNotes: { notes, fetchedAt: new Date() } } } };
      });
      return notes;
    } catch (err) {
      if (scope === accountScope() && err instanceof SessionEndedError) handleError(err);
      throw err;
    }
  }

  /**
   * The lessons of one week the sync doesn't read (it reads this week and
   * next): read when the Week view shows it, kept (a past week for good, a
   * future one for a day, as timetables still change).
   */
  async function loadWeek(child: string, monday: string): Promise<ScheduleLesson[]> {
    const scope = accountScope();
    const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
    const kept = getState().snapshot?.perChild[child]?.weeks?.[monday];
    const past = monday < mondayOf(today());
    if (kept && (past || Date.now() - new Date(kept.fetchedAt).getTime() < 86_400_000)) return kept.lessons;
    if (isDemo()) return [];
    try {
      const lessons = await kid(child).schedule.list({ from: monday, to: addDays(monday, 4) });
      patch((s) => {
        const data = s.perChild[child] ?? { lessons: [], notes: [], exams: [] };
        return { ...s, perChild: { ...s.perChild, [child]: { ...data, weeks: { ...data.weeks, [monday]: { lessons, fetchedAt: new Date() } } } } };
      });
      return lessons;
    } catch (err) {
      if (scope === accountScope() && err instanceof SessionEndedError) handleError(err);
      throw err;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Writing a new message                                              */
  /* ------------------------------------------------------------------ */

  const CONTACTS_FRESH_MS = 7 * 86_400_000;

  /**
   * Who the parent can write to about a child: the front page's class teacher
   * and supervisors, and Wilma's recipient list. Read when the parent starts a
   * message (three pages), kept for a week.
   */
  async function loadContacts(child: string, refresh = false): Promise<Contacts> {
    const scope = accountScope();
    const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
    const kept = getState().snapshot?.perChild[child]?.contacts;
    if (kept && !refresh && Date.now() - new Date(kept.fetchedAt).getTime() < CONTACTS_FRESH_MS) return kept;
    if (isDemo()) return demoContacts(child);
    try {
      const k = kid(child);
      const [details, recipients] = await Promise.all([k.student.get(), k.messages.recipients()]);
      const contacts: Contacts = { details, recipients, fetchedAt: new Date() };
      patch((s) => ({
        ...s,
        perChild: { ...s.perChild, [child]: { ...(s.perChild[child] ?? { lessons: [], notes: [], exams: [] }), contacts, className: { value: details.className, fetchedAt: new Date() } } },
      }));
      return contacts;
    } catch (err) {
      if (scope === accountScope() && err instanceof SessionEndedError) handleError(err);
      throw err;
    }
  }

  /** Prepare and send a new message about one child (the sample family sends nothing). */
  function messageApi(child: string) {
    return {
      prepare: async (recipient: MessageRecipient): Promise<write.MessageForm> => {
        if (isDemo()) {
          return { kind: "message", recipients: [recipient.name], form: { action: "", fields: [], buttons: [], selects: [], textareas: [] }, subjectField: "Subject", bodyField: "BodyText" };
        }
        return write.prepareMessage(kid(child), recipient);
      },
      send: async (form: write.MessageForm, subject: string, text: string): Promise<void> => {
        const scope = accountScope();
        if (isDemo()) {
          // Nothing is sent; the message shows as sent, as a real one does.
          patchSnapshot((s) => {
            const id = Math.max(0, ...Object.keys(s.messages).map(Number)) + 1;
            const now = new Date();
            const thread = { content: text, sentAt: now, recipients: form.recipients, replies: [], collated: false, fetchedAt: now };
            return { ...s, messages: { ...s.messages, [id]: { id, subject, sender: null, sentAt: now, unreadInWilma: false, replyCount: 0, children: [child], thread, sent: true } } };
          });
          return;
        }
        try {
          await write.sendMessage(kid(child), form, { subject, text });
          if (scope !== accountScope()) return;
          keepSession();
          // Sent: it shows in the inbox now, not only once someone answers. A failure here doesn't undo the sending.
          void loadSent(child).catch(() => {});
        } catch (err) {
          if (err instanceof SessionEndedError) handleError(err, scope);
          throw err;
        }
      },
    };
  }

  /** The day Wilma will record an absence for: today until 12:00, then tomorrow. */
  function absenceDay(): string {
    const now = today();
    return nowMinutesHelsinki() < 12 * 60 ? now : addDays(now, 1);
  }

  function nowMinutesHelsinki(): number {
    const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).split(":").map(Number);
    return h * 60 + m;
  }

  async function prepareAbsenceReport(child: string): Promise<write.AbsenceReportForm> {
    if (isDemo()) {
      const date = absenceDay();
      return {
        kind: "absence-report",
        date,
        dateLabel: date === today() ? "Tänään" : "Huomenna",
        reasons: [{ value: "83", label: "Terveydellinen syy" }],
        acceptsText: true,
        guidance: "Voit ilmoittaa tämän päivän poissaolosta klo 12 asti, ja klo 12 jälkeen seuraavan päivän poissaolosta. Poissaoloilmoitus näkyy opettajilla Wilmassa.",
        form: { action: "", fields: [], buttons: [], selects: [], textareas: [] },
        reasonField: "type",
        textField: "text",
        noticesBefore: [],
      };
    }
    return write.prepareAbsenceReport(kid(child));
  }

  async function sendAbsenceReport(child: string, form: write.AbsenceReportForm, reason: string, text: string): Promise<string | null> {
    const said = isDemo() ? t("Sample family: nothing was sent.") : (await write.sendAbsenceReport(kid(child), form, { reason, text })).notice;
    const date = form.date ?? absenceDay();
    const label = form.reasons.find((r) => r.value === reason)?.label ?? reason;
    setState((s) => ({
      local: {
        ...s.local,
        reported: { ...s.local.reported, [child]: { ...(s.local.reported?.[child] ?? {}), [date]: { at: Date.now(), reason: label } } },
      },
    }));
    return said;
  }

  /**
   * A send stopped because the session changed (another WilmAI program's
   * session continued, or none is alive): nothing was sent. Prepare the form
   * again under the session now in use and return it; when no session is alive,
   * show the sign-in page (drafts stay) and return null.
   */
  async function preparedAgain<T>(err: unknown, prepare: () => Promise<T>): Promise<T | null> {
    const scope = accountScope();
    if (!(err instanceof SessionEndedError)) throw err;
    try {
      return await prepare();
    } catch (again) {
      handleError(again, scope);
      return null;
    }
  }

  /** The English text (the dictionary key); show sessionChangedNote(), or t(SESSION_CHANGED_NOTE). */


  /** SESSION_CHANGED_NOTE in the app's language. */
  const sessionChangedNote = (): string => t(SESSION_CHANGED_NOTE);

  function isDemo(): boolean {
    return getState().snapshot?.account.via === "demo";
  }

  return {
    current: store.current,
    resume, signInWithPassword, cliAccounts, signInWithCli, getBack, signInDemo, leaveDemo, signOut, signInAgain, isSessionEnded, keepAlive, withSent, syncNow, openMessage, openNews, replyApi, answerInvitation, declineInvitation, loadGradebook, loadPastExams, loadYearNotes, loadWeek, loadContacts, messageApi, absenceDay, prepareAbsenceReport, sendAbsenceReport, preparedAgain, sessionChangedNote, isDemo,
    cancelPending(foregroundOnly = false) { if (signIns.pending && (!foregroundOnly || focusOnCommit)) invalidateSignIn(); },
    dispose() { invalidateSignIn(); api = null; },
  };
}

export type AccountEngine = ReturnType<typeof createAccountEngine>;
