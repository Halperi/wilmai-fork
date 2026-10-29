import "./shim.ts";
import "fake-indexeddb/auto";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { get, set } from "idb-keyval";
import { WilmaClient, SessionEndedError, type ClientOptions } from "@wilma-client/src/core";
import { accountId, refKey } from "../src/data/account-id.ts";
import { engineFor, resetApp, resume, signInWithPassword, signOut } from "../src/data/engine.ts";
import { accountStore, accountStorageKey, activateAccount, flushPersisted, getState, knownAccounts, loadPersisted, selectAccount, selectedAccountId, setState, updateSettings } from "../src/data/store.ts";
import { emptySnapshot, type AccountInfo } from "../src/data/model.ts";
import { overrideBridge } from "../src/wilma/transport.ts";

// Same username and pupil number at two different Wilmas must remain different sources.
const a: AccountInfo = { baseUrl: "https://first.inschool.fi", username: "parent", tenantName: "First", via: "password" };
const b: AccountInfo = { ...a, baseUrl: "https://second.inschool.fi", tenantName: "Second" };

test("account identities reject URLs with embedded secrets", () => {
  assert.throws(() => accountId({ ...a, baseUrl: "https://parent:synthetic-secret@first.inschool.fi" }), /without credentials/);
  assert.throws(() => accountId({ ...a, baseUrl: "https://first.inschool.fi?token=synthetic-secret" }), /without credentials/);
  assert.equal(accountId({ ...a, baseUrl: `${a.baseUrl}/`, via: "cli", cliIndex: 17 }), accountId(a));
});
const stateFor = (account: AccountInfo) => JSON.stringify({ cookies: [{ key: "Wilma2SID", value: new URL(account.baseUrl).hostname, domain: new URL(account.baseUrl).hostname, path: "/", hostOnly: true }] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => resolve = yes);
  return { promise, resolve };
}
async function setup(t: TestContext) {
  await resetApp();
  const reads: string[] = [];
  t.mock.method(WilmaClient.prototype, "students", async function(this: WilmaClient) { reads.push(this.exportSession()); return []; });
  t.mock.method(WilmaClient.prototype, "logout", async () => true);
  t.mock.method(WilmaClient, "login", async (profile: AccountInfo, _mfa: unknown, options: ClientOptions) => WilmaClient.resumeSession(profile.baseUrl, stateFor(profile), options)!);
  overrideBridge(async (path) => {
    if (path === "session/set") return { ok: true };
    if (path === "session/get") return null;
    throw new Error(`Unexpected synthetic call: ${path}`);
  });
  t.after(async () => { await resetApp(); overrideBridge(null); });
  return reads;
}
async function login(account: AccountInfo, remember = true) {
  await signInWithPassword(account.baseUrl, account.username, `synthetic-${account.tenantName}`, undefined, false, undefined, remember);
}

test("two live clients keep their own cookies and can be used without changing the selected account", async (t) => {
  const reads = await setup(t);
  await login(a); await login(b);
  const before = reads.length;
  await engineFor(a).keepAlive();
  await engineFor(b).keepAlive();
  assert.equal(reads.length, before + 2);
  assert.match(reads[before], /first.inschool.fi/);
  assert.match(reads[before + 1], /second.inschool.fi/);
  assert.equal(selectedAccountId(), accountId(b));
  const sa = await accountStore(a).savedSession();
  const sb = await accountStore(b).savedSession();
  assert.match(sa!.state, /first.inschool.fi/);
  assert.match(sb!.state, /second.inschool.fi/);
  assert.notEqual(sa!.sharedKey, sb!.sharedKey);
});

test("overlapping pupils, messages, local marks, translations and AI results stay in their source store", async (t) => {
  await setup(t); await login(a); await login(b);
  for (const account of [a, b]) {
    const store = accountStore(account);
    const snapshot = emptySnapshot(account);
    snapshot.children = [{ number: "7", name: account.tenantName!, first: "Same", color: 0 }];
    snapshot.news[801] = { id: 801, title: account.tenantName!, subtitle: null, author: null, published: new Date(), pinned: false, children: ["7"] };
    store.setState({ snapshot, local: { opened: { "m:801": account === a ? 1 : 2 }, done: {} }, luna: { "m:801": { v: "test", hash: account.tenantName!, at: 1, model: "test", action: null, events: [], dropped: 0 } } });
  }
  assert.equal(accountStore(a).getState().snapshot!.news[801].title, "First");
  assert.equal(accountStore(b).getState().snapshot!.news[801].title, "Second");
  assert.equal(accountStore(a).getState().local.opened["m:801"], 1);
  assert.equal(accountStore(b).getState().luna["m:801"].hash, "Second");
  assert.notEqual(refKey({ accountId: accountId(a), id: 801 }), refKey({ accountId: accountId(b), id: 801 }));
  assert.throws(() => accountStore(a).setState({ snapshot: emptySnapshot(b) }), /another account/);
  assert.throws(() => accountStore(a).saveSession({ account: b, state: stateFor(b) }), /Wrong account session/);
});

test("a read completing after selection changes updates only its original account", async (t) => {
  await setup(t); await login(a); await login(b);
  const answer = deferred<[]>();
  t.mock.method(WilmaClient.prototype, "forStudent", () => ({ gradebook: { get: () => answer.promise } }));
  const reading = engineFor(a).loadGradebook("7");
  selectAccount(accountId(b));
  answer.resolve([]); await reading;
  assert.ok(accountStore(a).getState().snapshot!.perChild["7"].gradebook);
  assert.equal(accountStore(b).getState().snapshot!.perChild["7"], undefined);
  assert.equal(selectedAccountId(), accountId(b));
});

test("ending one account leaves the other client's session, password and state intact", async (t) => {
  const reads = await setup(t); await login(a); await login(b);
  const before = await accountStore(b).savedSession();
  await engineFor(a).signOut();
  await engineFor(b).keepAlive();
  assert.equal(await accountStore(a).savedSession(), null);
  assert.deepEqual(await accountStore(b).savedSession(), before);
  assert.equal(accountStore(a).getState().settings.wilmaPassword, "");
  assert.equal(accountStore(b).getState().settings.wilmaPassword, "synthetic-Second");
  assert.match(reads.at(-1)!, /second.inschool.fi/);
  assert.equal(getState().phase, "ready");
  assert.equal(getState().snapshot!.account.baseUrl, b.baseUrl);
});

test("an expired session reports an error for its source without signing out the selected account", async (t) => {
  await setup(t); await login(a); await login(b);
  const aCookie = (await accountStore(a).savedSession())!.state;
  t.mock.method(WilmaClient.prototype, "students", async function(this: WilmaClient) {
    if (this.exportSession() === aCookie) throw new SessionEndedError();
    return [];
  });
  await engineFor(a).keepAlive();
  assert.equal(accountStore(a).getState().phase, "signed-out");
  assert.equal(accountStore(b).getState().phase, "ready");
  assert.equal(selectedAccountId(), accountId(b));
});

test("both sessions and account-specific login choices survive restart; display and AI preferences are shared", async (t) => {
  await setup(t); await login(a); await login(b, false);
  accountStore(a).updateSettings({ staySignedIn: true });
  updateSettings({ language: "fi", aiProvider: "off" });
  assert.equal(accountStore(a).getState().settings.language, "fi");
  assert.equal(accountStore(a).getState().settings.staySignedIn, true);
  assert.equal(accountStore(b).getState().settings.rememberPassword, false);
  await flushPersisted();
  const persisted = await get("accounts.v2");
  assert.equal(persisted.version, 2);
  assert.equal(JSON.stringify(persisted).includes("synthetic-First"), false, "passwords are kept in separate local storage, not the account database");
  assert.equal(localStorage.getItem("wilmai.wilmaPassword"), null);
  const loaded = await loadPersisted(); await resume(loaded.session);
  assert.equal(accountStore(a).getState().phase, "ready");
  assert.equal(accountStore(b).getState().phase, "ready");
  assert.equal(accountStore(a).getState().settings.wilmaPassword, "synthetic-First");
  assert.equal(accountStore(b).getState().settings.wilmaPassword, "");
  assert.equal(selectedAccountId(), accountId(b));
});

test("version 1 migration assigns legacy password, session and draft only to their original account and is repeatable", async (t) => {
  await setup(t);
  await set("snapshot", emptySnapshot(a));
  await set("session", { account: a, state: stateFor(a) });
  await set("accounts", { [accountId(b)]: { snapshot: emptySnapshot(b), local: { opened: { "m:801": 2 }, done: {} } } });
  localStorage.setItem("wilmai.settings", JSON.stringify({ rememberPassword: true, staySignedIn: true }));
  localStorage.setItem("wilmai.wilmaPassword", btoa("wilmai::synthetic-legacy"));
  localStorage.setItem("wilmai.draft.801", "Legacy draft");
  // Startup can adjust a device preference (e.g. an unavailable AI provider) before loading the old account.
  setState({ settings: { ...getState().settings, rememberPassword: true, staySignedIn: true, wilmaPassword: "synthetic-legacy" } });
  updateSettings({ aiProvider: "off" });
  await loadPersisted();
  assert.equal(accountStore(a).getState().settings.wilmaPassword, "synthetic-legacy");
  assert.equal(accountStore(b).getState().settings.wilmaPassword, "");
  assert.equal(await accountStore(b).savedSession(), null);
  assert.equal(accountStore(b).getState().settings.staySignedIn, false);
  assert.equal(accountStore(a).getState().settings.staySignedIn, true);
  assert.equal(await get("session"), undefined, "retire global cookies only after the account migration commits");
  assert.equal(localStorage.getItem(accountStorageKey("draft.801")), "Legacy draft");
  assert.equal(localStorage.getItem("wilmai.wilmaPassword"), null);
  await loadPersisted();
  assert.equal(knownAccounts().length, 2);
  assert.equal(accountStore(a).getState().settings.wilmaPassword, "synthetic-legacy");
  assert.equal(accountStore(b).getState().local.opened["m:801"], 2);
});

test("reset invalidates handles for every account and no late write can restore either cache or session", async (t) => {
  await setup(t); await login(a); await login(b);
  const oldA = accountStore(a), oldB = accountStore(b);
  await resetApp();
  oldA.setState({ snapshot: emptySnapshot(a) });
  oldB.updateSettings({ wilmaPassword: "synthetic-late" });
  await oldA.saveSession({ account: a, state: stateFor(a) });
  await flushPersisted();
  assert.deepEqual(knownAccounts(), []);
  assert.equal(await get("accounts.v2"), undefined);
  assert.equal(getState().snapshot, null);
  assert.equal(localStorage.getItem("wilmai.wilmaPassword"), null);
});

test("an engine rejects a different account before obtaining any client or persisting credentials", async (t) => {
  await setup(t);
  await assert.rejects(engineFor(a).signInWithPassword(b.baseUrl, b.username, "synthetic-wrong-target"), /Wrong account runtime/);
  await assert.rejects(engineFor(a).resume({ account: b, state: stateFor(b) }), /Wrong account runtime/);
  assert.equal(await accountStore(a).savedSession(), null);
  assert.equal(accountStore(a).getState().settings.wilmaPassword, "");
});

test("a logged-out version 1 installation with cached accounts reaches the sign-in screen", async (t) => {
  await setup(t);
  await set("accounts", { [accountId(a)]: { snapshot: emptySnapshot(a), local: { opened: {}, done: {} } } });
  const loaded = await loadPersisted(); await resume(loaded.session);
  assert.equal(getState().phase, "signed-out");
  assert.equal(getState().snapshot, null);
  activateAccount(a);
  assert.equal(getState().snapshot?.account.baseUrl, a.baseUrl);
});

test("startup can resume a saved client when its snapshot has not been cached yet", async (t) => {
  await setup(t);
  activateAccount(a);
  await accountStore(a).saveSession({ account: a, state: stateFor(a) });
  await flushPersisted();
  const loaded = await loadPersisted(); await resume(loaded.session);
  assert.equal(getState().phase, "ready");
  assert.equal(getState().snapshot?.account.baseUrl, a.baseUrl);
});

test("overlapping resets both finish before a new login can commit", async (t) => {
  await setup(t); await login(a);
  const logout = deferred<boolean>();
  t.mock.method(WilmaClient.prototype, "logout", () => logout.promise);
  const first = resetApp();
  const second = resetApp();
  const signing = login(b);
  logout.resolve(true);
  await Promise.all([first, second, signing]);
  assert.equal(getState().phase, "ready");
  assert.equal(getState().snapshot?.account.baseUrl, b.baseUrl);
  assert.equal((await accountStore(b).savedSession())?.account.baseUrl, b.baseUrl);
});

test("signing out the selected account does not cancel another account's pending recovery", async (t) => {
  await setup(t); await login(a); await login(b);
  const own = accountStore(a);
  const saved = (await own.savedSession())!;
  own.setState({ phase: "signed-out" });
  await own.saveSession({ ...saved, state: "" });
  const entry = deferred<{ state: string; savedAt: number; by: string }>();
  const started = deferred<void>();
  overrideBridge(async (path) => {
    if (path === "session/get") { started.resolve(); return entry.promise; }
    if (path === "session/set") return { ok: true };
    throw new Error(`Unexpected synthetic call: ${path}`);
  });
  const recovering = engineFor(a).getBack();
  await started.promise;
  await signOut();
  entry.resolve({ state: saved.state, savedAt: Date.now(), by: "cli" });
  assert.equal(await recovering, true);
  assert.equal(own.getState().phase, "ready");
  assert.equal(accountStore(b).getState().phase, "signed-out");
  assert.equal(selectedAccountId(), accountId(b), "background recovery cannot move the UI");
});

test("an unknown storage version is rejected without replacing its data", async (t) => {
  await setup(t);
  const future = { version: 99, preserved: "synthetic-future-data" };
  await set("accounts.v2", future);
  await assert.rejects(loadPersisted(), /Unsupported account storage version/);
  await flushPersisted();
  assert.deepEqual(await get("accounts.v2"), future);
});

test("inconsistent legacy account identities stop migration without assigning cookies or erasing credentials", async (t) => {
  await setup(t);
  await set("snapshot", emptySnapshot(a));
  await set("session", { account: b, state: stateFor(b) });
  localStorage.setItem("wilmai.wilmaPassword", btoa("wilmai::synthetic-unassigned"));
  await assert.rejects(loadPersisted(), /accounts differ/);
  assert.equal(await get("accounts.v2"), undefined);
  assert.equal((await get("session")).account.baseUrl, b.baseUrl);
  assert.ok(localStorage.getItem("wilmai.wilmaPassword"));
});

test("a login accepted by Wilma before store reload cannot commit into the replacement account stores", async (t) => {
  await setup(t); await login(a);
  const students = deferred<[]>();
  const started = deferred<void>();
  t.mock.method(WilmaClient.prototype, "students", async function(this: WilmaClient) {
    if (this.exportSession().includes("second.inschool.fi")) { started.resolve(); return students.promise; }
    return [];
  });
  const signing = login(b);
  const cancelled = assert.rejects(signing, /Sign-in cancelled/);
  await started.promise;
  await loadPersisted();
  students.resolve([]);
  await cancelled;
  assert.equal(getState().snapshot?.account.baseUrl, a.baseUrl);
  assert.equal(accountStore(b).getState().settings.wilmaPassword, "");
});
