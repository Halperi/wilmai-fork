import "./shim.ts";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { mockIPC } from "@tauri-apps/api/mocks";
import { initialUpdate } from "../src/data/update-state";

Object.assign(globalThis, { window: globalThis });
let failCheck = false, failDownload = false, failRestart = false;
let announced: string | null = "0.1.1";
const commands: string[] = [];
mockIPC((command) => {
  commands.push(command);
  if (command === "app_edition") return { localAi: true, signedUpdater: true };
  if (command === "plugin:app|version") return "0.1.0";
  if (command === "plugin:updater|check") {
    if (failCheck) throw new Error("offline / missing feed");
    return announced ? { rid: 1, version: announced, currentVersion: "0.1.0", body: "A fix", rawJson: {} } : null;
  }
  if (command === "plugin:updater|download") { if (failDownload) throw new Error("invalid signature"); return 2; }
  if (command === "restart_after_update" && failRestart) throw new Error("restart failed");
  return undefined;
});
const { checkForUpdate, compareVersions, downloadUpdate, installUpdate } = await import("../src/data/updates");
const { getState, setState } = await import("../src/data/store");

test("failed check never claims latest and preserves a previously found update", async () => {
  setState({ update: { ...initialUpdate } });
  failCheck = true;
  await checkForUpdate();
  assert.equal(getState().update.checkedAt, null);
  assert.equal(getState().update.error, "check");
  failCheck = false;
  await checkForUpdate();
  const found = getState().update;
  assert.equal(found.available?.version, "0.1.1");
  assert.equal(found.available?.canInstall, true);
  failCheck = true;
  await checkForUpdate();
  assert.equal(getState().update.available, found.available);
  assert.equal(getState().update.checkedAt, found.checkedAt);
  failCheck = false;
});

test("signature/download failure is retryable and install requires a completed download", async () => {
  commands.length = 0;
  failDownload = true;
  await downloadUpdate();
  assert.equal(getState().update.phase, "idle");
  assert.equal(getState().update.error, "download");
  await installUpdate();
  assert.ok(!commands.includes("plugin:updater|install"));
  failDownload = false;
  await downloadUpdate();
  assert.equal(getState().update.phase, "ready");
  failRestart = true;
  await installUpdate();
  assert.equal(getState().update.phase, "ready");
  assert.equal(getState().update.error, "install");
  assert.ok(commands.includes("resume_after_failed_update"), "a failed upgrade allows local inference again");
  assert.ok(commands.indexOf("prepare_app_update") < commands.indexOf("plugin:updater|install"));
  failRestart = false;
  await installUpdate();
  assert.equal(commands.filter((c) => c === "plugin:updater|install").length, 1, "retrying restart does not reinstall a consumed archive");
  setState((s) => ({ update: { ...s.update, phase: "idle" } }));
});

test("successful no-update check clears the old notice and SemVer treats prereleases correctly", async () => {
  announced = null;
  await checkForUpdate();
  assert.equal(getState().update.available, null);
  assert.equal(getState().update.error, null);
  assert.ok(getState().update.checkedAt);
  assert.ok(compareVersions("0.1.0", "0.1.0-beta.1") > 0);
  assert.ok(compareVersions("0.1.0-beta.2", "0.1.0-beta.10") < 0);
});
