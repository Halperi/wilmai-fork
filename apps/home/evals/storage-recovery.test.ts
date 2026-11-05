import test from "node:test";
import assert from "node:assert/strict";
import { StorageRecovery, storageFault } from "../src/data/storage-recovery.ts";
const settled = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function fixture() {
  const state = { blocked: true, visible: true, available: false, recoveries: 0, checks: 0, failures: 0 };
  const timers = new Map<number, () => void>(); let sequence = 0;
  const loop = new StorageRecovery({
    eligible: () => state.blocked && state.visible,
    available: async () => { state.checks++; return state.available; },
    recover: async () => { state.recoveries++; if (state.failures-- > 0) throw new Error("temporary"); state.blocked = false; },
    later: (f) => { timers.set(++sequence, f); return sequence; },
    cancel: (id) => { timers.delete(id as number); },
  });
  const next = async () => { const entry = timers.entries().next().value; if (entry) { const [id, f] = entry; timers.delete(id); f(); await settled(); } };
  return { state, timers, loop, next };
}

test("early visibility waits for protected data; native wake and a later retry recover without another visibility event", async () => {
  const f = fixture();
  f.loop.wake(); await settled();
  assert.equal(f.state.recoveries, 0); assert.equal(f.timers.size, 1);
  f.state.available = true; f.state.failures = 1;
  f.loop.wake(); await settled(); // UIKit event arrives, but Keychain is still briefly unavailable.
  assert.equal(f.state.recoveries, 1); assert.equal(f.timers.size, 1);
  await f.next();
  assert.equal(f.state.recoveries, 2); assert.equal(f.state.blocked, false); assert.equal(f.timers.size, 0);
  f.loop.dispose();
});

test("hidden phones pause retries and permanent errors are ineligible", async () => {
  const f = fixture(); f.loop.wake(); await settled();
  f.state.visible = false; f.loop.pause();
  assert.equal(f.timers.size, 0);
  const checks = f.state.checks; f.loop.wake(); await settled();
  assert.equal(f.state.checks, checks);
  f.state.blocked = false; f.state.visible = true; f.loop.wake(); await settled();
  assert.equal(f.state.checks, checks);
  f.loop.dispose();
});

test("attempts are bounded; a new explicit/native wake can recover after exhaustion", async () => {
  const f = fixture(); f.loop.wake(); await settled();
  for (let n = 0; n < 15; n++) await f.next();
  assert.equal(f.state.checks, 8); assert.equal(f.timers.size, 0);
  f.state.available = true; f.loop.wake(); await settled();
  assert.equal(f.state.recoveries, 1); assert.equal(f.state.blocked, false);
  f.loop.dispose();
});

test("multiple wake-ups cannot run parallel recoveries; disposing cancels delayed work", async () => {
  let release!: () => void, active = 0, peak = 0, blocked = true;
  const pending = new Promise<void>((r) => { release = r; });
  const loop = new StorageRecovery({
    eligible: () => blocked, available: async () => true,
    recover: async () => { peak = Math.max(peak, ++active); await pending; active--; blocked = false; },
    later: () => { throw new Error("unexpected timer"); }, cancel: () => {},
  });
  loop.wake(); await settled(); loop.wake(); loop.wake();
  release(); await settled(); assert.equal(peak, 1);
  loop.dispose(); loop.wake(); await settled(); assert.equal(active, 0);
});

test("diagnostics distinguish transient lock from corruption/entitlements without exposing raw private errors", () => {
  assert.deepEqual(storageFault("iOS Keychain unavailable (-25308)"), { retryable: true, code: "KEYCHAIN:-25308" });
  assert.deepEqual(storageFault("iOS Keychain unavailable (-25291)"), { retryable: true, code: "KEYCHAIN:-25291" });
  for (const e of ["Invalid secure storage format", "Installation identity mismatch; existing vault preserved", new SyntaxError("synthetic private input"), "iOS Keychain unavailable (-34018)"]) assert.equal(storageFault(e).retryable, false);
  assert.equal(JSON.stringify(storageFault(new Error("synthetic-private-password"))).includes("synthetic-private-password"), false);
});
