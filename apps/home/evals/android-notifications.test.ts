import { setNow } from "./shim.ts";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
setNow(new Date("2026-11-02T12:00:00Z").getTime());
const calls: { command: string; args: Record<string, any> }[] = [];
const pending = new Set<number>();
const native = { invoke: async (command: string, args: Record<string, any> = {}) => {
  calls.push({ command, args });
  if (command.endsWith("vault_identity")) return args.legacy ?? args.proposed;
  if (command.endsWith("vault_load")) return null;
  if (command.endsWith("vault_save") || command.endsWith("configure") || command.endsWith("remove_active")) return;
  if (command.endsWith("check_permissions")) return { permissionState: "granted" };
  if (command.endsWith("cancel_schedules")) { pending.clear(); return; }
  if (command.endsWith("pending_ids")) return [...pending];
  if (command.endsWith("batch")) { for (const n of args.notifications) pending.add(n.id); return; }
  if (command.endsWith("show")) { assert.equal(args.schedule, undefined, "Android show does not persist scheduled alarms"); return; }
  if (command.endsWith("cancel")) { for (const id of args.notifications) pending.delete(id); return; }
  throw new Error(`Unexpected native command: ${command}`);
} };
Object.assign(globalThis, { __TAURI_INTERNALS__: native, __APP_PLATFORM__: "android", window: { __TAURI_INTERNALS__: native } });
const store = await import("../src/data/store.ts");
const { emptySnapshot } = await import("../src/data/model.ts");
const notifications = await import("../src/data/mobile-notifications.ts");
await store.loadSecrets();
const snapshot = emptySnapshot({ baseUrl: "https://synthetic.inschool.fi", username: "synthetic", tenantName: "Synthetic", via: "password" });
snapshot.syncedAt = new Date();
snapshot.children = [{ number: "1", name: "Synthetic Child", first: "Synthetic", color: 0 }];
snapshot.perChild["1"] = { syncedAt: new Date(), lessons: [{ date: "2026-11-03", dayOfWeek: 2, groupId: 1, start: "08:00", end: "08:45", subject: "Mathematics", subjectCode: "MA", teacher: "S", teacherCode: "S", room: "1" }], notes: [], exams: [] };
store.setState((s) => ({ phase: "ready", snapshot, settings: { ...s.settings, aiProvider: "openai", openaiKey: "synthetic-key", schoolNotifications: { digest: true, digestTime: "19:00" } } }));

test("Android summary is persistently registered, survives reconciliation and is cancelled on sign-out", async () => {
  await notifications.refreshSchoolNotifications();
  assert.equal(store.getState().schoolNotificationError ?? null, null);
  const scheduled = pending.size;
  assert.ok(scheduled > 0);
  assert.equal(calls.filter((c) => c.command.endsWith("batch")).length, scheduled);
  const alarm = calls.find((c) => c.command.endsWith("batch"))!.args.notifications[0];
  assert.equal(alarm.channelId, "wilmai-school");
  assert.ok(!JSON.stringify(alarm).includes("Synthetic Child"));
  await notifications.refreshSchoolNotifications();
  assert.equal(calls.filter((c) => c.command.endsWith("batch")).length, scheduled, "registered digest is not resubmitted on every reconcile");
  // An OS alarm can survive a process crash before metadata is written. Android 14's native
  // cancelAll is used, rather than trusting only the plugin's saved IDs.
  pending.add(1999999999);
  store.setState({ phase: "signed-out" });
  await notifications.clearSchoolNotifications();
  assert.equal(pending.size, 0);
  assert.ok(calls.some((c) => c.command === "plugin:android-device|cancel_schedules"));
  assert.equal(calls.filter((c) => c.command.endsWith("configure")).at(-1)!.args.enabled, false);
});
