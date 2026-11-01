import "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";

const calls: { command: string; args: unknown }[] = [];
const native = { invoke: async (command: string, args: unknown) => {
  calls.push({ command, args });
  if (command === "app_edition") return { localAi: false, signedUpdater: false };
  if (command === "plugin:app|version") return "0.2.1";
  if (command === "wilma_send") return { status: 200, url: "https://school.inschool.fi/", location: null, setCookie: [], contentType: "text/html", body: "synthetic reply" };
  throw new Error(`Unexpected native command: ${command}`);
} };
Object.assign(globalThis, { __TAURI_INTERNALS__: native, __APP_PLATFORM__: "ios", window: { __TAURI_INTERNALS__: native } });
const { bridgeCall, wilmaTransport, isNativeApp, isDesktopApp, isMobileApp, oldKeychain } = await import("../src/wilma/transport.ts");
const { appEdition } = await import("../src/data/edition.ts");
const { startUpdateChecks } = await import("../src/data/updates.ts");

test("iOS uses the native Wilma transport with its own cookie and redirect handling", async () => {
  assert.equal(isNativeApp, true);
  assert.equal(isMobileApp, true);
  assert.equal(isDesktopApp, false);
  const response = await wilmaTransport({ url: "https://school.inschool.fi/", method: "GET", headers: { cookie: "Wilma2SID=synthetic" } });
  assert.equal(response.body, "synthetic reply");
  const wire = calls.find((c) => c.command === "wilma_send")!.args as { wire: { cookie: string } };
  assert.equal(wire.wire.cookie, "Wilma2SID=synthetic");
});

test("iOS never reads Mac CLI credentials, legacy keychain or the shared CLI session file", async () => {
  const count = calls.length;
  assert.deepEqual(await bridgeCall("cli/accounts"), { accounts: [] });
  assert.deepEqual(await bridgeCall("session/get", { body: { key: "a".repeat(64) } }), { state: null });
  assert.deepEqual(await bridgeCall("session/set", { body: { key: "a".repeat(64), state: "synthetic" } }), { ok: true });
  assert.equal(oldKeychain, null);
  assert.equal(calls.length, count);
});

test("iOS gets native capabilities and version without starting the desktop updater", async () => {
  assert.deepEqual(await appEdition(), { localAi: false, signedUpdater: false });
  startUpdateChecks();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.some((c) => c.command === "plugin:app|version"));
  assert.equal(calls.some((c) => c.command === "update_manifest"), false);
});
