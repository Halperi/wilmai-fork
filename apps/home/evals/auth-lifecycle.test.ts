import "./shim.ts";
import "fake-indexeddb/auto";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { AuthenticationError, WilmaClient, type ClientOptions, type SessionEvent } from "@wilma-client/src/core";
import { getBack, PasswordRefusedError, resetApp, resume, signInDemo, signInWithCli, signInWithPassword, signOut } from "../src/data/engine.ts";
import { activateAccount, flushPersisted, getState, saveSession, savedSession, setState, updateSettings } from "../src/data/store.ts";
import { emptySnapshot, type AccountInfo } from "../src/data/model.ts";
import { overrideBridge, type WireRequest, type WireResponse } from "../src/wilma/transport.ts";
import { SignInCancelledError } from "../src/data/sign-in-attempt.ts";

const own: AccountInfo = { baseUrl: "https://school.inschool.fi", username: "parent", tenantName: null, via: "password" };
const other: AccountInfo = { ...own, username: "other-parent" };
const sharedKey = "a".repeat(64);
const cookieState = JSON.stringify({ cookies: [{ key: "Wilma2SID", value: "synthetic-session", domain: "school.inschool.fi", path: "/", hostOnly: true }] });
const realLogout = WilmaClient.prototype.logout;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function setup(t: TestContext) {
  await resetApp();
  // No pupils: exercise sign-in and persistence without starting a data sync for a real child.
  t.mock.method(WilmaClient.prototype, "students", async () => []);
  t.mock.method(WilmaClient.prototype, "logout", async () => true);
  t.after(async () => { await signOut(); overrideBridge(null); });
}

async function installEndedSession() {
  activateAccount(own);
  setState({ snapshot: emptySnapshot(own), phase: "signed-out" });
  await saveSession({ account: own, state: "", sharedKey });
}

function history() { return localStorage.getItem("wilmai.sessionHistory"); }

for (const action of ["reset", "sign-out", "demo"] as const) test(`a late shared-session recovery cannot undo ${action}`, async (t) => {
  await setup(t);
  await installEndedSession();
  const started = deferred<void>();
  const entry = deferred<unknown>();
  overrideBridge(async (path) => {
    if (path === "session/get") { started.resolve(); return entry.promise; }
    if (path === "session/set") return { ok: true };
    throw new Error(`Unexpected bridge call: ${path}`);
  });
  const recovering = getBack();
  await started.promise;
  if (action === "reset") await resetApp();
  else if (action === "sign-out") await signOut();
  else await signInDemo();
  const before = history();
  entry.resolve({ state: cookieState, savedAt: Date.now(), by: "cli" });
  assert.equal(await recovering, false);
  await flushPersisted();
  assert.equal(getState().phase, action === "demo" ? "ready" : "signed-out");
  assert.equal(getState().snapshot?.account.via ?? null, action === "demo" ? "demo" : null);
  assert.equal(await savedSession(), null);
  assert.equal(history(), before, "an obsolete result cannot recreate sign-in history");
});

test("a delayed startup resume cannot replace a demo chosen meanwhile", async (t) => {
  await setup(t);
  await installEndedSession();
  const started = deferred<void>();
  const entry = deferred<unknown>();
  overrideBridge(async (path) => {
    assert.equal(path, "session/get");
    started.resolve(); return entry.promise;
  });
  const resuming = resume({ account: own, state: "", sharedKey });
  await started.promise;
  await signInDemo();
  const before = history();
  entry.resolve({ state: cookieState, savedAt: Date.now(), by: "cli" });
  await resuming;
  assert.equal(getState().snapshot?.account.via, "demo");
  assert.equal(history(), before);
});

test("late login success cannot save an obsolete account or shared session", async (t) => {
  await setup(t);
  const started = deferred<void>();
  const answer = deferred<void>();
  const writes: string[] = [];
  overrideBridge(async (path) => {
    if (path === "session/set") { writes.push(path); return { ok: true }; }
    throw new Error(`Unexpected bridge call: ${path}`);
  });
  t.mock.method(WilmaClient, "login", async (_profile: unknown, _mfa: unknown, options: ClientOptions) => {
    started.resolve(); await answer.promise;
    // The real client publishes through this callback before returning from login.
    await options.sharedSession?.save(cookieState);
    return WilmaClient.resumeSession(own.baseUrl, cookieState, options)!;
  });
  const login = signInWithPassword(own.baseUrl, own.username, "synthetic-password");
  const settled = login.then(() => "success", () => "cancelled");
  await started.promise;
  await resetApp();
  answer.resolve();
  assert.equal(await settled, "cancelled");
  await flushPersisted();
  assert.equal(getState().snapshot, null);
  assert.equal(await savedSession(), null);
  assert.equal(history(), null);
  assert.deepEqual(writes, [], "a discarded login cannot publish its shared session");
});

test("a late failure from automatic sign-in cannot sign out a newer login", async (t) => {
  await setup(t);
  await installEndedSession();
  updateSettings({ staySignedIn: true, wilmaPassword: "synthetic-password" });
  const started = deferred<void>();
  const answer = deferred<WilmaClient>();
  overrideBridge(async (path) => {
    if (path === "session/get") return null;
    if (path === "session/set") return { ok: true };
    throw new Error(`Unexpected bridge call: ${path}`);
  });
  t.mock.method(WilmaClient, "login", async (profile: {username: string}, _mfa: unknown, options: ClientOptions) => {
    if (profile.username === own.username) { started.resolve(); return answer.promise; }
    return WilmaClient.resumeSession(other.baseUrl, cookieState, options)!;
  });
  const recovering = getBack();
  await started.promise;
  await signInWithPassword(other.baseUrl, other.username, "synthetic-other-password");
  answer.reject(new Error("synthetic old failure"));
  assert.equal(await recovering, false);
  assert.equal(getState().phase, "ready");
  assert.equal(getState().snapshot?.account.username, other.username);
  assert.equal(getState().signedOutReason, null);
  assert.equal((await savedSession())?.account.username, other.username);
});

/** Exercise the real WilmaClient login/MFA protocol through the app's transport, without a network. */
function fakeWilma(options: { mfa?: boolean; loginResponse?: () => Promise<void> } = {}) {
  const requests: WireRequest[] = [];
  const sharedWrites: string[] = [];
  overrideBridge(async (path, init) => {
    if (path === "session/get") return null;
    if (path === "session/set") { sharedWrites.push((init.body as {state: string}).state); return { ok: true }; }
    assert.equal(path, "wilma");
    const wire = init.body as WireRequest;
    requests.push(wire);
    const url = new URL(wire.url);
    const response: WireResponse = { status: 200, url: wire.url, location: null, setCookie: [], contentType: "text/html", body: "" };
    if (url.pathname === "/login" && wire.method === "GET") {
      response.body = '<input type="hidden" name="SESSIONID" value="synthetic-token">';
    } else if (url.pathname === "/login" && wire.method === "POST") {
      await options.loginResponse?.();
      response.setCookie = ["Wilma2SID=synthetic-session; Path=/; Secure"];
      if (options.mfa) { response.status = 303; response.location = "/mfa"; }
      else response.body = "<html>Signed in</html>";
    } else if (url.pathname === "/mfa") {
      response.body = '<input id="mfa-formkey" value="synthetic-challenge">';
    } else if (url.pathname.endsWith("/mfa/otp/check")) {
      const payload = JSON.parse(new URLSearchParams(wire.body).get("payload")!);
      response.contentType = "application/json";
      response.body = JSON.stringify({ success: payload.otp === "123456" });
    } else if (url.pathname === "/") {
      response.body = '<form id="logout-form" action="/logout"><input name="formkey" value="synthetic-logout-key"></form>';
    } else if (url.pathname === "/logout" && wire.method === "POST") {
      response.status = 303; response.location = "/login";
    } else throw new Error(`Unexpected synthetic request: ${wire.method} ${url.pathname}`);
    return response;
  });
  return { requests, sharedWrites };
}

test("a real login response arriving after reset cannot restore the password or shared session", async (t) => {
  await setup(t);
  const started = deferred<void>();
  const answer = deferred<void>();
  const fake = fakeWilma({ loginResponse: () => { started.resolve(); return answer.promise; } });
  const login = signInWithPassword(own.baseUrl, own.username, "synthetic-password", undefined, false, "guardian", true);
  const settled = assert.rejects(login, SignInCancelledError);
  await started.promise;
  await resetApp();
  answer.resolve();
  await settled;
  await flushPersisted();
  assert.equal(getState().settings.wilmaPassword, "");
  assert.equal(localStorage.getItem("wilmai.wilmaPassword"), null);
  assert.equal(await savedSession(), null);
  assert.equal(history(), null);
  assert.deepEqual(fake.sharedWrites, []);
});

test("accepted password login remembers the password and publishes one shared session", async (t) => {
  await setup(t);
  const fake = fakeWilma();
  assert.equal(await signInWithPassword(own.baseUrl, own.username, "synthetic-password", undefined, false, "guardian", true), null);
  assert.equal(getState().snapshot?.account.username, own.username);
  assert.equal(getState().settings.wilmaPassword, "synthetic-password");
  assert.ok(localStorage.getItem("wilmai.wilmaPassword"));
  assert.equal((await savedSession())?.account.username, own.username);
  assert.equal(fake.sharedWrites.length, 1, "publish only after accepting the account");
  assert.equal(JSON.parse(history()!)[0].kind, "signed-in");
});

test("an abandoned MFA dialog cannot submit a code or publish a session", async (t) => {
  await setup(t);
  const fake = fakeWilma({ mfa: true });
  const next = await signInWithPassword(own.baseUrl, own.username, "synthetic-password");
  assert.ok(next);
  assert.deepEqual(fake.sharedWrites, []);
  await signInDemo();
  const count = fake.requests.length;
  await assert.rejects(next.mfa("123456"), SignInCancelledError);
  assert.equal(fake.requests.length, count, "a stale code must not be sent to Wilma");
  assert.equal(getState().snapshot?.account.via, "demo");
  assert.deepEqual(fake.sharedWrites, []);
});

test("MFA can retry a refused code and complete the original attempt", async (t) => {
  await setup(t);
  const fake = fakeWilma({ mfa: true });
  const next = await signInWithPassword(own.baseUrl, own.username, "synthetic-password");
  assert.ok(next);
  await assert.rejects(next.mfa("000000"), /newest code/);
  await next.mfa("123456");
  assert.equal(getState().phase, "ready");
  assert.equal((await savedSession())?.account.username, own.username);
  assert.equal(fake.sharedWrites.length, 1);
});

test("automatic sign-in stops when an MFA code requires the user", async (t) => {
  await setup(t);
  await installEndedSession();
  updateSettings({ staySignedIn: true, wilmaPassword: "synthetic-password" });
  const fake = fakeWilma({ mfa: true });
  assert.equal(await getBack(), false);
  assert.equal(getState().phase, "signed-out");
  assert.match(getState().rejoin.failed!, /two-step code/);
  assert.deepEqual(fake.sharedWrites, []);
});

test("a late browser CLI continuation cannot replace a newer password login", async (t) => {
  await setup(t);
  const started = deferred<void>();
  const answer = deferred<unknown>();
  // This exercises the browser-development fallback; desktop CLI paths have their own tests.
  const fake = async (path: string, init: {body?: unknown}) => {
    if (path === "cli/session") { started.resolve(); return answer.promise; }
    if (path === "session/set") return { ok: true };
    throw new Error(`Unexpected bridge call: ${path}`);
  };
  overrideBridge(fake);
  const login = signInWithCli({ index: 0, ...own });
  const settled = assert.rejects(login, SignInCancelledError);
  await started.promise;
  t.mock.method(WilmaClient, "login", async (_profile: unknown, _mfa: unknown, options: ClientOptions) => WilmaClient.resumeSession(other.baseUrl, cookieState, options)!);
  await signInWithPassword(other.baseUrl, other.username, "synthetic-other-password");
  const before = history();
  answer.resolve({ tenantName: null, students: [], state: cookieState, key: sharedKey, continued: null });
  await settled;
  assert.equal(getState().snapshot?.account.username, other.username);
  assert.equal((await savedSession())?.account.username, other.username);
  assert.equal(history(), before);
});

test("a replacement sign-in invalidates an attempt still waiting for logout", async (t) => {
  await setup(t);
  fakeWilma();
  await signInWithPassword(own.baseUrl, own.username, "synthetic-password");
  const logout = deferred<boolean>();
  t.mock.method(WilmaClient.prototype, "logout", () => logout.promise);
  const leaving = signOut();
  const old = signInWithPassword(own.baseUrl, own.username, "synthetic-old-password");
  const settled = assert.rejects(old, SignInCancelledError);
  const fresh = signInWithPassword(other.baseUrl, other.username, "synthetic-new-password");
  logout.resolve(true);
  await leaving; await settled; await fresh;
  assert.equal(getState().snapshot?.account.username, other.username);
  assert.equal((await savedSession())?.account.username, other.username);
});

test("a new sign-in waits for a reset that is still clearing the previous account", async (t) => {
  await setup(t);
  fakeWilma();
  await signInWithPassword(own.baseUrl, own.username, "synthetic-password");
  const logout = deferred<boolean>();
  t.mock.method(WilmaClient.prototype, "logout", () => logout.promise);
  const resetting = resetApp();
  const fresh = signInWithPassword(other.baseUrl, other.username, "synthetic-new-password");
  logout.resolve(true);
  await resetting; await fresh;
  assert.equal(getState().phase, "ready");
  assert.equal(getState().snapshot?.account.username, other.username);
  assert.equal((await savedSession())?.account.username, other.username);
});

test("logout still ends an accepted client's Wilma session after local cancellation", async (t) => {
  await setup(t);
  t.mock.method(WilmaClient.prototype, "logout", realLogout);
  const fake = fakeWilma();
  await signInWithPassword(own.baseUrl, own.username, "synthetic-password");
  await signOut();
  const sent = fake.requests.filter(r => new URL(r.url).pathname === "/logout");
  assert.equal(sent.length, 1);
  assert.match(sent[0].cookie!, /Wilma2SID=synthetic-session/);
  assert.equal(new URLSearchParams(sent[0].body).get("formkey"), "synthetic-logout-key");
  assert.equal(await savedSession(), null);
});

test("a stale session-adopted callback cannot recreate history or overwrite the current session", async (t) => {
  await setup(t);
  const listeners: ((event: SessionEvent) => void)[] = [];
  t.mock.method(WilmaClient.prototype, "onSessionEvent", (callback: (event: SessionEvent) => void) => listeners.push(callback));
  fakeWilma();
  await signInWithPassword(own.baseUrl, own.username, "synthetic-password");
  const old = listeners[0];
  await resetApp();
  await signInWithPassword(other.baseUrl, other.username, "synthetic-new-password");
  const before = history();
  old("adopted");
  await flushPersisted();
  assert.equal(history(), before);
  assert.equal((await savedSession())?.account.username, other.username);
});

test("a cancelled recovery's cleanup cannot clear a newer single-flight recovery", async (t) => {
  await setup(t);
  await installEndedSession();
  const firstStarted = deferred<void>();
  const secondStarted = deferred<void>();
  const firstEntry = deferred<unknown>();
  const secondEntry = deferred<unknown>();
  let reads = 0;
  overrideBridge(async (path) => {
    if (path === "session/get") {
      reads++;
      if (reads === 1) { firstStarted.resolve(); return firstEntry.promise; }
      secondStarted.resolve(); return secondEntry.promise;
    }
    if (path === "session/set") return { ok: true };
    throw new Error(`Unexpected bridge call: ${path}`);
  });
  const old = getBack();
  await firstStarted.promise;
  const leaving = signOut();
  await installEndedSession();
  const fresh = getBack();
  assert.equal(await old, false);
  await leaving; await secondStarted.promise;
  assert.equal(getBack(), fresh, "a second tick joins the existing recovery");
  firstEntry.resolve(null);
  secondEntry.resolve({ state: cookieState, savedAt: Date.now(), by: "cli" });
  assert.equal(await fresh, true);
  assert.equal(reads, 2);
});

test("a refused remembered password is forgotten inside its current attempt", async (t) => {
  await setup(t);
  await installEndedSession();
  updateSettings({ wilmaPassword: "synthetic-password", staySignedIn: true });
  t.mock.method(WilmaClient, "login", async () => { throw new AuthenticationError("Wrong password"); });
  await assert.rejects(signInWithPassword(own.baseUrl, own.username, "synthetic-password"), PasswordRefusedError);
  assert.equal(getState().settings.wilmaPassword, "");
  assert.equal(getState().settings.staySignedIn, false);
});

test("a late password refusal cannot clear a newer remembered password", async (t) => {
  await setup(t);
  await installEndedSession();
  updateSettings({ wilmaPassword: "synthetic-password", staySignedIn: true });
  const started = deferred<void>();
  const answer = deferred<WilmaClient>();
  t.mock.method(WilmaClient, "login", async () => { started.resolve(); return answer.promise; });
  const old = assert.rejects(signInWithPassword(own.baseUrl, own.username, "synthetic-password"), SignInCancelledError);
  await started.promise;
  await signInDemo();
  updateSettings({ wilmaPassword: "synthetic-new-password", staySignedIn: true });
  answer.reject(new AuthenticationError("Old refused password"));
  await old;
  assert.equal(getState().settings.wilmaPassword, "synthetic-new-password");
  assert.equal(getState().settings.staySignedIn, true);
});
