import { setNow } from "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../src/data/model.ts";
import { getState, setState } from "../src/data/store.ts";
import { LunaError, decide, openAIPaused, openAIReach, openAIReady } from "../src/luna/client.ts";
import { overrideBridge } from "../src/wilma/transport.ts";

// A school or work network that blocks OpenAI: one clear stop and a pause of a few minutes, never a loop of retries.
const questions = [{ type: "predicate" as const, name: "needed", instructions: "Does this need a response?" }];
const answer = { status: 200, retryAfter: null, fromOpenai: true, body: JSON.stringify({ usage: { input_tokens: 0 }, answers: [{ type: "predicate", name: "needed", probability: 0.9 }] }) };
const start = Date.parse("2026-10-21T08:00:00Z");
const unreachable = (err: unknown) => err instanceof LunaError && !err.retryable && /can't be reached from this network/.test(err.message);

function setup() {
  setNow(start);
  setState({ settings: { ...DEFAULT_SETTINGS, aiProvider: "openai", openaiKey: "synthetic-blocked-test-key" }, usage: {}, openaiBlocked: null });
}

test("a network that can't reach OpenAI stops at the first call and pauses for a few minutes", async () => {
  setup();
  let calls = 0;
  overrideBridge(async () => {
    calls++;
    throw new Error("Couldn't reach OpenAI: error sending request: dns error: no such host");
  });
  try {
    await assert.rejects(decide("Hei", questions), unreachable);
    assert.equal(calls, 1, "no retries");
    assert.equal(getState().openaiBlocked?.reason, "network");
    assert.match(getState().openaiBlocked?.detail ?? "", /dns error/);
    assert.equal(openAIPaused(), true);
    await assert.rejects(decide("Hei", questions), unreachable);
    setNow(start + 4 * 60_000);
    assert.equal(await openAIReady(), false);
    assert.equal(calls, 1, "paused: nothing is sent");
  } finally {
    overrideBridge(null);
  }
});

test("a filter's block page isn't OpenAI's answer, even with HTTP 200", async () => {
  setup();
  overrideBridge(async () => ({ status: 200, retryAfter: null, fromOpenai: false, body: "<html>Blocked by the school's filter</html>" }));
  try {
    await assert.rejects(decide("Hei", questions), unreachable);
    assert.deepEqual(getState().openaiBlocked, { at: start, reason: "intercepted", detail: "HTTP 200" });
  } finally {
    overrideBridge(null);
  }
});

test("after the pause one quick check decides, and a reachable OpenAI carries on", async () => {
  setup();
  setState({ openaiBlocked: { at: start, reason: "network", detail: null } });
  setNow(start + 6 * 60_000);
  const paths: string[] = [];
  overrideBridge(async (path) => {
    paths.push(path);
    return path === "openai-reach" ? { reachable: true, reason: null, detail: null } : answer;
  });
  try {
    assert.equal(await openAIReady(), true);
    assert.equal(getState().openaiBlocked, null);
    await decide("Hei", questions);
    assert.deepEqual(paths, ["openai-reach", "openai"]);
  } finally {
    overrideBridge(null);
  }
});

test("the check before a key is added records what the computer saw", async () => {
  setup();
  let calls = 0;
  overrideBridge(async () => {
    calls++;
    return { reachable: false, reason: "intercepted", detail: "HTTP 403" };
  });
  try {
    const [a, b] = await Promise.all([openAIReach(), openAIReach()]);
    assert.equal(calls, 1, "one check at a time");
    assert.equal(a, b);
    assert.deepEqual(getState().openaiBlocked, { at: start, reason: "intercepted", detail: "HTTP 403" });
    overrideBridge(async () => { throw new Error("connection timed out"); });
    assert.equal((await openAIReach()).reason, "network");
    assert.equal(getState().openaiBlocked?.detail, "connection timed out");
  } finally {
    overrideBridge(null);
  }
});

test("a refused key is still the key's problem, not the network's", async () => {
  setup();
  overrideBridge(async () => ({ status: 401, retryAfter: null, fromOpenai: true, body: "{}" }));
  try {
    await assert.rejects(decide("Hei", questions), /didn't accept the API key/);
    assert.equal(getState().openaiBlocked, null);
  } finally {
    overrideBridge(null);
  }
});
