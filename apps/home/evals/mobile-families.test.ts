import "./shim.ts";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { clear } from "idb-keyval";
import type { VaultData } from "../src/data/secure-vault.ts";

const platform = process.env.WILMAI_TEST_PLATFORM === "android" ? "android" : "ios";
const account = { baseUrl: "https://north.inschool.fi", username: "synthetic-parent", tenantName: "Synthetic north", via: "password" as const };
const linked = { ...account, baseUrl: "https://south.inschool.fi", tenantName: "Synthetic south" };
const separate = { ...account, baseUrl: "https://other.inschool.fi", username: "another-parent" };
const key = (a: typeof account) => JSON.stringify([a.baseUrl, a.username]);
const cookie = (a: typeof account) => JSON.stringify({ cookies: [{ key: "Wilma2SID", value: "synthetic", domain: new URL(a.baseUrl).hostname, path: "/", hostOnly: true }] });
const original: VaultData = {
  version: 1,
  preferences: { rememberPassword: true, staySignedIn: true, aiProvider: "off" } as VaultData["preferences"],
  credentials: { jevKey: "", openaiKey: "synthetic-api-key", wilmaPassword: "", passwords: { [key(account)]: "north-password", [key(linked)]: "south-password", [key(separate)]: "other-password" } },
  session: { account, state: cookie(account) },
  linkedSessions: { [key(linked)]: { account: linked, state: cookie(linked) } },
  families: { active: key(account), entries: {
    [key(account)]: { account, logins: [{ slot: 0, account }, { slot: 3, account: linked, hidden: ["7@3"] }], lastSlot: 5, viewAs: "guardian" },
    [key(separate)]: { account: separate, logins: [{ slot: 0, account: separate, signedOut: true }] },
  } },
};
let raw = JSON.stringify(original);
const native = { invoke: async (command: string, args: { installation: string; data: string }) => {
  const prefix = platform === "ios" ? "ios_vault_" : "plugin:android-device|vault_";
  if (command === prefix + "identity") return "00000000-0000-4000-8000-000000000001";
  if (command === prefix + "load") return raw;
  if (command === prefix + "save") { raw = args.data; return; }
  throw new Error("Unexpected synthetic command");
} };
Object.assign(globalThis, { __TAURI_INTERNALS__: native, __APP_PLATFORM__: platform, window: { __TAURI_INTERNALS__: native } });
const store = await import("../src/data/store.ts");
const engine = await import("../src/data/engine.ts");
const { overrideBridge } = await import("../src/wilma/transport.ts");
let loginRequests = 0;
overrideBridge(async (path, init) => {
  if (path === "wilma" && new URL((init.body as { url: string }).url).pathname === "/login") loginRequests++;
  return { error: "Synthetic offline transport", status: 503 };
});

test(`${platform}: an unreadable cache blocks startup and preserves account membership`, async () => {
  await store.loadSecrets();
  const before = raw;
  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function () { throw new DOMException("Synthetic locked database", "InvalidStateError"); };
  try {
    await assert.rejects(store.loadPersisted());
    assert.equal(store.getState().phase, "loading");
    assert.equal(store.getState().secureStorage.ready, false);
    assert.equal(raw, before);
  } finally { IDBDatabase.prototype.transaction = transaction; }
});

test(`${platform}: empty WebView storage restores both Wilmas, their slots and remembered credentials through normal startup`, async () => {
  await store.loadSecrets();
  const { session } = await store.loadPersisted();
  const snap = store.getState().snapshot!;
  assert.deepEqual(snap.logins?.map((l) => [l.slot, l.account.baseUrl]), [[0, account.baseUrl], [3, linked.baseUrl]]);
  assert.equal(snap.lastSlot, 5);
  assert.deepEqual(snap.logins?.[1].hidden, ["7@3"]);
  assert.equal(store.knownFamilies().length, 2);
  assert.deepEqual(store.familyFor(linked), account);
  assert.deepEqual(store.familyFor(separate), separate);
  assert.equal(store.passwordOf(account), "north-password");
  assert.equal(store.passwordOf(linked), "south-password");
  assert.equal(store.getState().settings.openaiKey, "synthetic-api-key");
  await engine.resume(session);
  await engine.syncNow();
  assert.equal(store.getState().phase, "ready");
  assert.equal(store.getState().loginStatus[0]?.live, true);
  assert.equal(store.getState().loginStatus[3]?.live, true);
  assert.equal(store.getState().loginStatus[1], undefined);
  assert.equal(loginRequests, 0);
  for (const name of ["wilmai.passwords", "wilmai.openaiKey", "wilmai.wilmaPassword"]) assert.equal(localStorage.getItem(name), null);
});

async function loseWebViewCache() {
  await store.flushPersisted();
  await clear();
  localStorage.clear();
  // A cold WebView starts with no snapshot. The native vault is retained.
  store.getState().snapshot = null;
  return store.loadPersisted();
}

test(`${platform}: deliberate sign-out survives cache loss while one-click credentials remain`, async () => {
  await engine.signOut();
  const { session } = await loseWebViewCache();
  assert.equal(session, null);
  assert.ok(store.getState().snapshot?.logins?.every((l) => l.signedOut));
  await engine.resume(session);
  assert.equal(store.getState().phase, "signed-out");
  assert.equal(loginRequests, 0);
  assert.equal(store.passwordOf(account), "north-password");
  assert.equal(store.passwordOf(linked), "south-password");
});

test(`${platform}: removing a Wilma never revives it or reuses its slot after cache loss`, async () => {
  await engine.removeWilma(3);
  await loseWebViewCache();
  assert.deepEqual(store.getState().snapshot?.logins?.map((l) => l.slot), [0]);
  assert.equal(store.getState().snapshot?.lastSlot, 5);
  assert.equal(store.familyFor(linked), null);
  assert.equal(store.passwordOf(linked), "");
  assert.equal(store.passwordOf(separate), "other-password");
  store.forgetFamily(separate);
  await loseWebViewCache();
  assert.equal(store.familyFor(separate), null);
  assert.equal(store.passwordOf(separate), "");
});

test(`${platform}: a sign-out marker also wins over a stale session saved before termination`, async () => {
  await store.saveSession({ account, state: cookie(account) });
  const { session } = await loseWebViewCache();
  assert.ok(session, "model a process terminated before its old session was cleared");
  await engine.resume(session);
  assert.equal(store.getState().phase, "signed-out");
  assert.equal(store.getState().loginStatus[0]?.live, false);
  assert.equal(loginRequests, 0);
  await store.saveSession(null);
});

test(`${platform}: explicit reset clears native account membership as well as secrets`, async () => {
  await engine.resetApp();
  await clear();
  await store.loadPersisted();
  assert.equal(store.getState().snapshot, null);
  assert.deepEqual(store.knownFamilies(), []);
  assert.deepEqual(JSON.parse(raw).families, { active: null, entries: {} });
  assert.deepEqual(JSON.parse(raw).credentials.passwords, {});
  assert.equal(JSON.parse(raw).credentials.openaiKey, "");
});
