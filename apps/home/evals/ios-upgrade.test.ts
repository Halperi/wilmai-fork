import "./shim.ts";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { get } from "idb-keyval";

// Fixture from the shipped iOS app, deliberately independent of the refactored constant.
const originalKey = "wilmai.iosInstallation";
const originalId = "00000000-0000-4000-8000-000000000001";
const account = { baseUrl: "https://school.inschool.fi", username: "synthetic-parent", tenantName: "Synthetic", via: "password" as const };
const other = { ...account, baseUrl: "https://other.inschool.fi", username: "other-parent" };
const key = (a: typeof account) => JSON.stringify([a.baseUrl, a.username]);
const original = {
  version: 1,
  credentials: { jevKey: "synthetic-jev", openaiKey: "synthetic-openai", wilmaPassword: "synthetic-current-password",
    passwords: { [key(account)]: "synthetic-password-a", [key(other)]: "synthetic-password-b" } },
  session: { account, state: "synthetic-cookie-a" },
  linkedSessions: { [key(other)]: { account: other, state: "synthetic-cookie-b" } },
};
let envelope: { installation: string; data: string } | null = { installation: originalId, data: JSON.stringify(original) };
const reads: string[] = [];
const native = { invoke: async (command: string, args: { installation: string; data: string }) => {
  if (command === "ios_vault_load") {
    reads.push(args.installation);
    // Model the native reinstall guard: a different installation deletes the old envelope.
    if (envelope && envelope.installation !== args.installation) envelope = null;
    return envelope?.data ?? null;
  }
  if (command === "ios_vault_save") { envelope = { installation: args.installation, data: args.data }; return; }
  throw new Error(`Unexpected native command: ${command}`);
} };
Object.assign(globalThis, { __TAURI_INTERNALS__: native, __APP_PLATFORM__: "ios", window: { __TAURI_INTERNALS__: native } });
localStorage.setItem(originalKey, originalId);
localStorage.setItem("wilmai.settings", JSON.stringify({ rememberPassword: true }));
const store = await import("../src/data/store.ts");
const { secureInstallation } = await import("../src/data/secure-vault.ts");

test("upgrading the shipped iOS app opens the existing vault without losing credentials or either account session", async () => {
  // The earlier migration already removed browser credentials and IndexedDB sessions.
  for (const name of ["wilmai.jevKey", "wilmai.openaiKey", "wilmai.passwords", "wilmai.wilmaPassword"])
    assert.equal(localStorage.getItem(name), null);
  assert.equal(await get("session"), undefined);
  assert.equal(await get("linkedSessions"), undefined);
  await store.loadSecrets();
  assert.deepEqual(reads, [originalId], "the first native read must use the shipped installation ID");
  assert.equal(localStorage.getItem(originalKey), originalId);
  assert.equal(localStorage.getItem("wilmai.secureInstallation"), null);
  assert.equal(store.getState().secureStorage.ready, true);
  assert.deepEqual(JSON.parse(envelope!.data), original);
  assert.equal(store.getState().settings.jevKey, original.credentials.jevKey);
  assert.equal(store.getState().settings.openaiKey, original.credentials.openaiKey);
  assert.equal(store.passwordOf(account), "synthetic-password-a");
  assert.equal(store.passwordOf(other), "synthetic-password-b");
  assert.deepEqual(await store.savedSession(), original.session);
  assert.deepEqual(await store.savedLinkedSessions(), original.linkedSessions);
});

test("explicit reset preserves the shipped installation ID while clearing its vault", async () => {
  await store.forgetEverything();
  assert.equal(localStorage.getItem(originalKey), originalId);
  assert.equal(envelope!.installation, originalId);
  assert.deepEqual(JSON.parse(envelope!.data).credentials, { jevKey: "", openaiKey: "", wilmaPassword: "", passwords: {} });
  assert.equal(secureInstallation(), originalId);
});

test("a fresh iOS installation persists its new ID under the original key", () => {
  localStorage.removeItem(originalKey);
  localStorage.removeItem("wilmai.secureInstallation");
  const freshId = secureInstallation();
  assert.match(freshId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(localStorage.getItem(originalKey), freshId);
  assert.equal(secureInstallation(), freshId);
  assert.equal(localStorage.getItem("wilmai.secureInstallation"), null);
});
