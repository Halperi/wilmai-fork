import "./shim.ts";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { get, set } from "idb-keyval";

// A packaged WKWebView may expose getRandomValues without secure-context randomUUID.
Object.defineProperty(globalThis, "crypto", { value: { getRandomValues: crypto.getRandomValues.bind(crypto) } });
let raw: string | null = null;
let failRead = true, failWrite = false;
const native = { invoke: async (command: string, args: { installation: string; data: string; legacy?: string; proposed: string }) => {
  if (command === "ios_vault_identity") return args.legacy ?? args.proposed;
  if (command === "ios_vault_load") { if (failRead) throw new Error("synthetic locked Keychain"); return raw; }
  if (command === "ios_vault_save") { if (failWrite) throw new Error("synthetic locked Keychain"); raw = args.data; return; }
  throw new Error(`Unexpected command ${command}`);
} };
Object.assign(globalThis, { __TAURI_INTERNALS__: native, __APP_PLATFORM__: "ios", window: { __TAURI_INTERNALS__: native } });
const account = { baseUrl: "https://school.inschool.fi", username: "synthetic-parent", tenantName: "Synthetic school", via: "password" as const };
const other = { ...account, baseUrl: "https://other.inschool.fi", username: "other-parent" };
const key = (a: typeof account) => JSON.stringify([a.baseUrl, a.username]);
const scramble = (s: string) => btoa(`wilmai::${s}`);
localStorage.setItem("wilmai.settings", JSON.stringify({ jevKey: "synthetic-legacy-jev", rememberPassword: true }));
localStorage.setItem("wilmai.openaiKey", scramble("synthetic-legacy-openai"));
localStorage.setItem("wilmai.passwords", scramble(JSON.stringify({ [key(account)]: "synthetic-password-a", [key(other)]: "synthetic-password-b" })));
await set("session", { account, state: "synthetic-cookie-a" });
await set("linkedSessions", { [key(other)]: { account: other, state: "synthetic-cookie-b" } });
const store = await import("../src/data/store.ts");
const { emptySnapshot } = await import("../src/data/model.ts");
const { iosVault, IOS_INSTALLATION_KEY } = await import("../src/data/ios-vault.ts");

test("iOS migration retains browser copies on read/write failure, then removes them after Keychain success", async () => {
  assert.equal(store.getState().settings.openaiKey, "", "credentials are gated until Keychain opens");
  await assert.rejects(store.loadSecrets());
  assert.equal(store.getState().secureStorage.ready, false);
  assert.ok(localStorage.getItem("wilmai.passwords"));
  assert.ok(await get("session"));
  failRead = false; failWrite = true;
  await assert.rejects(store.loadSecrets());
  assert.ok(localStorage.getItem("wilmai.openaiKey"));
  assert.ok(await get("linkedSessions"));
  failWrite = false;
  await store.loadSecrets();
  assert.equal(store.getState().secureStorage.ready, true);
  assert.equal(typeof crypto.randomUUID, "undefined");
  assert.match(localStorage.getItem(IOS_INSTALLATION_KEY)!, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(store.passwordOf(account), "synthetic-password-a");
  assert.equal(store.passwordOf(other), "synthetic-password-b");
  assert.equal(store.getState().settings.jevKey, "synthetic-legacy-jev");
  assert.equal((await store.savedSession())?.state, "synthetic-cookie-a");
  assert.equal((await store.savedLinkedSessions())[key(other)].state, "synthetic-cookie-b");
  for (const name of ["wilmai.jevKey", "wilmai.openaiKey", "wilmai.wilmaPassword", "wilmai.passwords"]) assert.equal(localStorage.getItem(name), null);
  assert.equal(JSON.parse(localStorage.getItem("wilmai.settings")!).jevKey, undefined);
  assert.equal(await get("session"), undefined);
  assert.equal(await get("linkedSessions"), undefined);
  assert.equal(JSON.parse(raw!).credentials.passwords[key(other)], "synthetic-password-b");
});

test("ongoing writes have no plaintext fallback and retry saves the newest value", async () => {
  failWrite = true;
  store.updateSettings({ openaiKey: "synthetic-new-openai" });
  await assert.rejects(store.flushPersisted());
  assert.equal(store.getState().secureStorage.ready, false);
  assert.equal(localStorage.getItem("wilmai.openaiKey"), null);
  assert.equal(JSON.parse(raw!).credentials.openaiKey, "synthetic-legacy-openai");
  failWrite = false;
  await store.loadSecrets();
  assert.equal(JSON.parse(raw!).credentials.openaiKey, "synthetic-new-openai");
  assert.equal(store.getState().secureStorage.error, null);
});

test("account sessions cannot be mixed and forgetting one account preserves the other", async () => {
  store.setState({ snapshot: emptySnapshot(account) });
  store.activateAccount(other);
  store.setState({ snapshot: emptySnapshot(other) });
  await store.saveSession({ account: other, state: "synthetic-current-b" });
  await store.saveLinkedSession(account, { account, state: "synthetic-linked-a" });
  assert.throws(() => store.saveLinkedSession(account, { account: other, state: "wrong-account" }), /mismatch/);
  store.forgetFamily(account);
  await store.flushPersisted();
  assert.equal(store.passwordOf(account), "");
  assert.equal(store.passwordOf(other), "synthetic-password-b");
  assert.equal((await store.savedSession())?.account.baseUrl, other.baseUrl);
  assert.equal((await store.savedLinkedSessions())[key(account)], undefined);
  assert.equal(await get("session"), undefined);
});

test("logout and reset persist empty session records and cannot revive cleared credentials", async () => {
  await store.saveSession(null);
  await store.saveLinkedSession(null, null);
  await store.loadSecrets();
  assert.equal(await store.savedSession(), null);
  assert.deepEqual(await store.savedLinkedSessions(), {});
  const installation = localStorage.getItem(IOS_INSTALLATION_KEY);
  await store.forgetEverything();
  assert.equal(localStorage.getItem(IOS_INSTALLATION_KEY), installation);
  assert.deepEqual(iosVault.data?.credentials, { jevKey: "", openaiKey: "", wilmaPassword: "", passwords: {} });
  await store.loadSecrets();
  assert.equal(store.getState().settings.openaiKey, "");
  assert.equal(store.passwordOf(other), "");
});
