import test from "node:test";
import assert from "node:assert/strict";
import { IosVault, emptyVault } from "../src/data/ios-vault.ts";

const installation = "00000000-0000-4000-8000-000000000001";
test("logout arriving during a Keychain write persists a tombstone after the old session", async () => {
  const saved: string[] = [];
  let release!: () => void;
  const paused = new Promise<void>((r) => { release = r; });
  const vault = new IosVault({ load: async () => null, save: async (_id, data) => { saved.push(data); if (saved.length === 1) await paused; } });
  await vault.load(installation);
  vault.update((v) => ({ ...v, credentials: { ...v.credentials, openaiKey: "synthetic-old-key" } }));
  const first = vault.flush();
  vault.update(() => emptyVault());
  const cleared = vault.flush();
  release();
  await Promise.all([first, cleared]);
  assert.equal(saved.length, 2);
  assert.deepEqual(JSON.parse(saved.at(-1)!), emptyVault());
});

test("failed Keychain writes remain retryable without falling back to browser storage", async () => {
  let fail = true, raw: string | null = null;
  const vault = new IosVault({ load: async () => null, save: async (_id, data) => { if (fail) throw new Error("locked"); raw = data; } });
  await vault.load(installation);
  vault.update((v) => ({ ...v, credentials: { ...v.credentials, openaiKey: "synthetic-new-key" } }));
  await assert.rejects(vault.flush(), /locked/);
  assert.equal(raw, null);
  fail = false;
  await vault.flush();
  assert.equal(JSON.parse(raw!).credentials.openaiKey, "synthetic-new-key");
});

test("an update scheduled as the previous save finishes is drained too", async () => {
  const saved: string[] = [];
  let vault!: IosVault;
  vault = new IosVault({ load: async () => null, save: async (_id, data) => {
    saved.push(data);
    if (saved.length === 1) queueMicrotask(() => {
      vault.update((v) => ({ ...v, credentials: { ...v.credentials, openaiKey: "synthetic-last" } }));
      void vault.flush();
    });
  } });
  await vault.load(installation);
  vault.update(() => emptyVault());
  await vault.flush();
  await vault.flush();
  assert.equal(JSON.parse(saved.at(-1)!).credentials.openaiKey, "synthetic-last");
});

test("corrupt or unsupported Keychain data is rejected without overwriting it", async () => {
  for (const raw of ["broken", '{"version":2}', JSON.stringify({ ...emptyVault(), credentials: { passwords: {} } })]) {
    let writes = 0;
    const vault = new IosVault({ load: async () => raw, save: async () => { writes++; } });
    await assert.rejects(vault.load(installation));
    assert.equal(writes, 0);
  }
});
