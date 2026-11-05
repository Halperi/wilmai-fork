import "./shim.ts";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";

const id = "00000000-0000-4000-8000-000000000001";
const account = { baseUrl: "https://school.inschool.fi", username: "synthetic-parent", tenantName: "Synthetic", via: "password" as const };
const key = JSON.stringify([account.baseUrl, account.username]);
const original = {
  version: 1,
  preferences: { aiProvider: "openai", language: "fi", theme: "dark", staySignedIn: true, rememberPassword: true, schoolNotifications: { digestHour: 19 } },
  credentials: { jevKey: "", openaiKey: "synthetic-api-key", wilmaPassword: "", passwords: { [key]: "synthetic-password" } },
  session: { account, state: "synthetic-cookie" }, linkedSessions: {},
};
let raw = JSON.stringify(original), failIdentity = true, writes = 0;
const native = { invoke: async (command: string, args: { installation: string; proposed: string; data: string }) => {
  if (command === "ios_vault_identity") {
    if (failIdentity) throw new Error("synthetic protected data unavailable");
    return id; // The native app-container marker survives WebKit storage loss.
  }
  if (command === "ios_vault_load") {
    if (args.installation !== id) throw new Error("Installation mismatch; existing vault preserved");
    return raw;
  }
  if (command === "ios_vault_save") { assert.equal(args.installation, id); writes++; raw = args.data; return; }
  throw new Error(`Unexpected command ${command}`);
} };
Object.assign(globalThis, { __TAURI_INTERNALS__: native, __APP_PLATFORM__: "ios", window: { __TAURI_INTERNALS__: native } });
// WebKit settings reset to defaults while the real settings and secrets remain native.
localStorage.setItem("wilmai.settings", JSON.stringify({ aiProvider: "off", rememberPassword: false, staySignedIn: false }));
const store = await import("../src/data/store.ts");
const { iosVault } = await import("../src/data/ios-vault.ts");

test("protected-data failure never creates a browser identity or overwrites the existing vault", async () => {
  await assert.rejects(store.loadSecrets());
  assert.equal(localStorage.getItem("wilmai.iosInstallation"), null);
  assert.equal(writes, 0);
  assert.deepEqual(JSON.parse(raw), original);
});

test("native identity and preferences restore after WebKit storage loss without clearing credentials", async () => {
  failIdentity = false;
  await store.loadSecrets();
  assert.equal(localStorage.getItem("wilmai.iosInstallation"), id);
  assert.equal(store.getState().secureStorage.ready, true);
  const settings = store.getState().settings;
  assert.equal(settings.aiProvider, "openai");
  assert.equal(settings.theme, "dark");
  assert.equal(settings.language, "fi");
  assert.equal(settings.staySignedIn, true);
  assert.equal(settings.rememberPassword, true);
  assert.equal(settings.openaiKey, "synthetic-api-key");
  assert.equal(store.passwordOf(account), "synthetic-password");
  assert.equal((await store.savedSession())?.state, "synthetic-cookie");
  assert.equal(JSON.parse(localStorage.getItem("wilmai.settings")!).aiProvider, "openai");
  assert.equal(JSON.parse(raw).credentials.openaiKey, "synthetic-api-key");
});

test("preference changes and explicit reset update the native copy too", async () => {
  store.updateSettings({ theme: "light", aiProvider: "off" });
  await store.flushPersisted();
  assert.equal(JSON.parse(raw).preferences.theme, "light");
  assert.equal(JSON.parse(raw).preferences.aiProvider, "off");
  assert.equal(iosVault.data?.credentials.openaiKey, "synthetic-api-key", "choosing off does not invent a key deletion");
  await store.forgetEverything();
  assert.equal(JSON.parse(raw).preferences.aiProvider, undefined);
  assert.equal(JSON.parse(raw).credentials.openaiKey, "");
  assert.equal(JSON.parse(raw).session, null);
  assert.equal(localStorage.getItem("wilmai.iosInstallation"), id);
});
