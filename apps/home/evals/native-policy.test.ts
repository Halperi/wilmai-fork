import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const native = fileURLToPath(new URL("../src-tauri/", import.meta.url));

test("native entry points have explicit local-window permissions and mobile cannot access desktop files", () => {
  const source = readFileSync(`${native}src/lib.rs`, "utf8");
  const handler = source.slice(source.indexOf("tauri::generate_handler!["), source.indexOf("        ])", source.indexOf("tauri::generate_handler![")));
  const commands = [...handler.matchAll(/^\s*(?:[a-z_]+::)?([a-z_]+),?\s*$/gm)].map((m) => m[1]);
  const manifest = readFileSync(`${native}build.rs`, "utf8");
  for (const command of commands) assert.ok(manifest.includes(`"${command}"`), `${command}: custom commands must opt into the ACL`);
  const permissions: string[] = [];
  for (const name of readdirSync(`${native}capabilities`).filter((n) => n.endsWith(".json"))) {
    const capability = JSON.parse(readFileSync(`${native}capabilities/${name}`, "utf8"));
    assert.equal(capability.remote, undefined, `${name}: no remote origin can invoke native APIs`);
    if (capability.platforms.some((p: string) => p === "iOS" || p === "android")) {
      assert.deepEqual(capability.windows, ["main"]);
      permissions.push(...capability.permissions.filter((p: unknown) => typeof p === "string"));
    }
  }
  for (const denied of ["allow-save-report", "allow-clear-reports", "allow-cli-login-secret", "allow-shared-session-get", "allow-secret-get", "allow-ollama-call", "updater:default", "notification:default"])
    assert.ok(!permissions.includes(denied), `mobile must not receive ${denied}`);
  for (const required of ["allow-wilma-send", "allow-ios-vault-load", "allow-ios-vault-save"]) assert.ok(permissions.includes(required));
  const csp = JSON.parse(readFileSync(`${native}tauri.conf.json`, "utf8")).app.security.csp;
  assert.ok(csp.includes("frame-src 'none'") && csp.includes("form-action 'none'"));
  assert.ok(!csp.includes("'unsafe-eval'"));
});
