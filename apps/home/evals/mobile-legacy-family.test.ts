import "./shim.ts";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";

const platform = process.env.WILMAI_TEST_PLATFORM === "android" ? "android" : "ios";
const account = { baseUrl: "https://north.inschool.fi", username: "parent", tenantName: null, via: "password" as const };
const other = { ...account, baseUrl: "https://south.inschool.fi", username: "another-parent" };
const key = (a: typeof account) => JSON.stringify([a.baseUrl, a.username]);
let raw = JSON.stringify({ version: 1, preferences: { rememberPassword: true, staySignedIn: true },
  credentials: { jevKey: "", openaiKey: "synthetic-api-key", wilmaPassword: "", passwords: { [key(account)]: "north-password", [key(other)]: "south-password", "malformed-key": "unidentified-password" } },
  session: null, linkedSessions: {} });
const native = { invoke: async (command: string, args: { data: string }) => {
  if (command.endsWith("vault_identity")) return "00000000-0000-4000-8000-000000000001";
  if (command.endsWith("vault_load")) return raw;
  if (command.endsWith("vault_save")) { raw = args.data; return; }
  throw new Error("Unexpected synthetic command");
} };
Object.assign(globalThis, { __TAURI_INTERNALS__: native, __APP_PLATFORM__: platform, window: { __TAURI_INTERNALS__: native } });
const store = await import("../src/data/store.ts");
const engine = await import("../src/data/engine.ts");
const { overrideBridge } = await import("../src/wilma/transport.ts");
let requests = 0;
overrideBridge(async () => { requests++; return { error: "Synthetic offline transport", status: 503 }; });

test(`${platform}: an older password-only vault recovers account choices without merging families or undoing sign-out`, async () => {
  await store.loadSecrets();
  const { session } = await store.loadPersisted();
  assert.deepEqual(store.getState().snapshot?.account, account);
  assert.equal(store.passwordOf(account), "north-password");
  assert.equal(store.getState().snapshot?.logins?.length, 1);
  assert.equal(store.knownFamilies().length, 2);
  assert.deepEqual(store.familyFor(other), other);
  assert.equal(store.passwordOf(other), "south-password");
  await engine.resume(session);
  assert.equal(store.getState().phase, "signed-out");
  assert.equal(requests, 0);
  assert.equal(JSON.parse(raw).credentials.openaiKey, "synthetic-api-key");
  assert.equal(JSON.parse(raw).credentials.passwords["malformed-key"], "unidentified-password", "unidentified secrets are preserved");
});
