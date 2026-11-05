import { setNow } from "./shim.ts";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
setNow(new Date("2026-11-02T12:00:00Z").getTime());
const calls: { command: string; args: Record<string, unknown> }[] = [];
let fail = false, release: (() => void) | null = null, pause: Promise<void> | null = null;
const native = { invoke: async (command: string, args: Record<string, unknown> = {}) => {
  calls.push({ command, args });
  if (command === "ios_vault_identity") return args.legacy ?? args.proposed;
  if (command === "ios_vault_load") return null;
  if (command === "ios_vault_save") return;
  if (command.endsWith("check_permissions")) return { permissionState: "granted" };
  if (command.endsWith("configure")) return { registered: true, available: true };
  if (command.endsWith("pending_ids")) return [];
  if (command.endsWith("show")) { if (pause) await pause; if (fail) throw new Error("synthetic rejection"); return args.id; }
  if (command.endsWith("cancel") || command.endsWith("remove_active")) return;
  throw new Error(`Unexpected command: ${command}`);
} };
Object.assign(globalThis, { __TAURI_INTERNALS__: native, __APP_PLATFORM__: "ios", window: { __TAURI_INTERNALS__: native } });
const store = await import("../src/data/store.ts");
const { emptySnapshot } = await import("../src/data/model.ts");
const notifications = await import("../src/data/mobile-notifications.ts");
await store.loadSecrets();
const snap = emptySnapshot({ baseUrl: "https://synthetic.inschool.fi", username: "synthetic-parent", tenantName: "Synthetic", via: "password" });
snap.children = [{ number: "1", name: "Synthetic Child", first: "Synthetic", color: 0 }];
snap.messages[1] = { id: 1, subject: "Sensitive synthetic topic", sender: "Synthetic Teacher", sentAt: new Date(Date.now() - 1000), unreadInWilma: true, replyCount: 0, children: ["1"] };
store.setState({ phase: "ready", snapshot: snap });
await notifications.refreshSchoolNotifications();

test("rejected native sends remain pending for retry, successful events are not duplicated", async () => {
  assert.equal(calls.filter((c) => c.command.endsWith("show")).length, 0, "initial load is quiet");
  store.setState((s) => ({ snapshot: { ...s.snapshot!, messages: { ...s.snapshot!.messages, 2: { ...snap.messages[1], id: 2 } } } }));
  fail = true;
  await notifications.refreshSchoolNotifications();
  assert.equal(store.getState().local.schoolNotificationLedger?.sources["messages:0"]["m:2"], undefined);
  assert.ok(store.getState().schoolNotificationError);
  fail = false;
  await notifications.refreshSchoolNotifications();
  assert.equal(store.getState().local.schoolNotificationLedger?.sources["messages:0"]["m:2"], "0");
  const count = calls.filter((c) => c.command.endsWith("show")).length;
  await notifications.refreshSchoolNotifications();
  assert.equal(calls.filter((c) => c.command.endsWith("show")).length, count);
  const sent = calls.filter((c) => c.command.endsWith("show")).at(-1)!.args;
  assert.ok(!JSON.stringify(sent).includes("Sensitive"));
  assert.ok(!JSON.stringify(sent).includes("synthetic-parent"));
  assert.equal((sent.extra as Record<string, unknown>).item, "m:2");
});

test("sign-out clears OS requests after an in-flight send and cannot write its ledger back", async () => {
  pause = new Promise<void>((resolve) => { release = resolve; });
  store.setState((s) => ({ snapshot: { ...s.snapshot!, messages: { ...s.snapshot!.messages, 3: { ...snap.messages[1], id: 3 } } } }));
  const work = notifications.refreshSchoolNotifications();
  // Let permission checks and the native call enter their await points.
  for (let n = 0; n < 20 && !calls.some((c) => (c.args.extra as Record<string, unknown>)?.item === "m:3"); n++) await new Promise<void>((r) => setImmediate(r));
  store.setState({ phase: "signed-out" });
  const clear = notifications.clearSchoolNotifications();
  release!(); pause = null;
  await Promise.all([work, clear]);
  assert.equal(store.getState().local.schoolNotificationLedger?.sources["messages:0"]["m:3"], undefined);
  const showAt = calls.findLastIndex((c) => (c.args.extra as Record<string, unknown>)?.item === "m:3");
  assert.ok(calls.findLastIndex((c) => c.command.endsWith("cancel")) > showAt);
  assert.ok(calls.findLastIndex((c) => c.command.endsWith("remove_active")) > showAt);
});
