import "./shim.ts";
import "fake-indexeddb/auto";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { ClientOptions } from "@wilma-client/src/core";

// Select the actual desktop CLI path before loading the engine. No native commands or user files are read.
const native = { invoke: async () => null };
Object.assign(globalThis, { __TAURI_INTERNALS__: native, window: { __TAURI_INTERNALS__: native } });
const { WilmaClient } = await import("@wilma-client/src/core");
const { getBack, resetApp, signInWithCli, signOut } = await import("../src/data/engine.ts");
const { activateAccount, getState, saveSession, savedSession, setState } = await import("../src/data/store.ts");
const { emptySnapshot } = await import("../src/data/model.ts");
const { overrideBridge } = await import("../src/wilma/transport.ts");
const { SignInCancelledError } = await import("../src/data/sign-in-attempt.ts");

const login = { index: 0, id: "synthetic-profile", baseUrl: "https://school.inschool.fi", username: "parent", tenantName: null };
const cookieState = JSON.stringify({ cookies: [{ key: "Wilma2SID", value: "synthetic-session", domain: "school.inschool.fi", path: "/", hostOnly: true }] });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => resolve = yes);
  return { promise, resolve };
}

async function setup(t: TestContext) {
  await resetApp();
  t.mock.method(WilmaClient.prototype, "students", async () => []);
  t.mock.method(WilmaClient.prototype, "logout", async () => true);
  t.after(async () => { await signOut(); overrideBridge(null); });
}

for (const stage of ["secret", "session", "students"] as const) test(`desktop CLI continuation cancelled during ${stage} cannot restore a reset account`, async (t) => {
  await setup(t);
  const started = deferred<void>();
  const answer = deferred<void>();
  const writes: unknown[] = [];
  const hold = async () => { started.resolve(); await answer.promise; };
  if (stage === "students") t.mock.method(WilmaClient.prototype, "students", async () => { await hold(); return []; });
  overrideBridge(async (path, init) => {
    if (path === "cli/secret") {
      if (stage === "secret") await hold();
      return { password: "synthetic-password", totpSecret: null };
    }
    if (path === "session/get") {
      if (stage === "session") await hold();
      return { state: cookieState, savedAt: Date.now(), by: "cli" };
    }
    if (path === "session/set") { writes.push(init.body); return { ok: true }; }
    throw new Error(`Unexpected bridge call: ${path}`);
  });
  const signing = signInWithCli(login);
  const settled = assert.rejects(signing, SignInCancelledError);
  await started.promise;
  assert.equal(await savedSession(), null, "do not persist before accepting the account");
  assert.equal(localStorage.getItem("wilmai.sessionHistory"), null);
  assert.deepEqual(writes, []);
  await resetApp();
  answer.resolve();
  await settled;
  assert.equal(getState().phase, "signed-out");
  assert.equal(getState().snapshot, null);
  assert.equal(await savedSession(), null);
  assert.equal(localStorage.getItem("wilmai.sessionHistory"), null);
  assert.deepEqual(writes, []);
});

test("desktop CLI continuation accepts a live session without a new login", async (t) => {
  await setup(t);
  let logins = 0;
  t.mock.method(WilmaClient, "login", async () => { logins++; throw new Error("Must continue the shared session"); });
  overrideBridge(async (path) => {
    if (path === "cli/secret") return { password: "synthetic-password", totpSecret: null };
    if (path === "session/get") return { state: cookieState, savedAt: Date.now(), by: "cli" };
    if (path === "session/set") return { ok: true };
    throw new Error(`Unexpected bridge call: ${path}`);
  });
  assert.equal(await signInWithCli(login), null);
  assert.equal(logins, 0);
  assert.equal(getState().phase, "ready");
  assert.equal((await savedSession())?.account.username, login.username);
  assert.equal(JSON.parse(localStorage.getItem("wilmai.sessionHistory")!)[0].kind, "continued");
});

test("desktop automatic recovery and password fallback share one cancellation lifetime", async (t) => {
  await setup(t);
  const account = { ...login, via: "cli" as const, cliIndex: 0 };
  activateAccount(account);
  setState({ snapshot: emptySnapshot(account), phase: "signed-out", settings: { ...getState().settings, staySignedIn: true } });
  await saveSession({ account, state: "", sharedKey: "a".repeat(64) });
  const started = deferred<void>();
  const answer = deferred<void>();
  const writes: unknown[] = [];
  overrideBridge(async (path, init) => {
    if (path === "cli/accounts") return { accounts: [login] };
    if (path === "cli/secret") return { password: "synthetic-password", totpSecret: null };
    if (path === "session/get") return null;
    if (path === "session/set") { writes.push(init.body); return { ok: true }; }
    throw new Error(`Unexpected bridge call: ${path}`);
  });
  t.mock.method(WilmaClient, "login", async (_profile: unknown, _mfa: unknown, options: ClientOptions) => {
    started.resolve(); await answer.promise;
    await options.sharedSession?.save(cookieState);
    return WilmaClient.resumeSession(login.baseUrl, cookieState, options)!;
  });
  const recovering = getBack();
  await started.promise;
  await resetApp();
  answer.resolve();
  assert.equal(await recovering, false);
  assert.equal(getState().snapshot, null);
  assert.equal(await savedSession(), null);
  assert.deepEqual(writes, []);
});
