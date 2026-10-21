import "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mockIPC } from "@tauri-apps/api/mocks";

// Establish the desktop surface before importing the app's transport.
Object.assign(globalThis, { window: globalThis });
mockIPC(() => undefined);
const { startLocalSetup, stopLocalSetup, setupSnapshot } = await import("../src/ai/managed.ts");
const { overrideBridge } = await import("../src/wilma/transport.ts");
const { getState, setState } = await import("../src/data/store.ts");
const { DEFAULT_SETTINGS } = await import("../src/data/model.ts");
const { MANAGED_ENDPOINT, LOCAL_DECIDER, LOCAL_READER, LOCAL_CONTEXT } = await import("../src/ai/config.ts");
const { checkOllama } = await import("../src/ai/ollama.ts");

function runtime(onDecision: () => Promise<void> = async () => undefined, fail = false) {
  let resident: string | null = null;
  const paths: string[] = [];
  overrideBridge(async (provider, init) => {
    assert.equal(provider, "ollama", "setup cannot call a cloud provider");
    assert.equal((init.body as { key?: string }).key, undefined, "a saved OpenAI key never reaches local transport");
    const wire = init.body as { endpoint: string; path: string; body: { model: string } };
    assert.equal(wire.endpoint, MANAGED_ENDPOINT); paths.push(wire.path);
    let value: unknown;
    switch (wire.path) {
      case "/api/version": value = { version: "b11535", wilmai_managed: true, wilmai_engine: "pinned" }; break;
      case "/api/tags": value = { models: [{ name: LOCAL_DECIDER, size: 6, digest: "clef-sha" }, { name: LOCAL_READER, size: 3, digest: "qwen-sha" }] }; break;
      case "/api/show": value = { capabilities: [wire.body.model === LOCAL_DECIDER ? "decision" : "completion"], details: { format: "gguf", quantization_level: "Q4_K_M" }, parameters: `num_ctx ${LOCAL_CONTEXT}` }; break;
      case "/api/ps": value = { models: resident ? [{ name: resident, context_length: LOCAL_CONTEXT }] : [] }; break;
      case "/api/generate": resident = null; value = {}; break;
      case "/v1/systemone": resident = LOCAL_DECIDER; await onDecision(); value = { answers: { finnish: fail ? {} : { type: "noul", noul: .9 } } }; break;
      case "/api/chat": resident = LOCAL_READER; value = { message: { content: '{"maximum":"25"}' } }; break;
      default: throw new Error(`Unexpected route ${wire.path}`);
    }
    return { status: 200, body: JSON.stringify(value) };
  });
  return paths;
}
const ready = { phase: "ready" };
function reset(commands: string[] = []) {
  setState({ settings: { ...DEFAULT_SETTINGS, openaiKey: "saved-key", aiProvider: "off" }, snapshot: null, jev: {}, luna: {} });
  mockIPC((command) => { commands.push(command); return command === "local_ai_status" ? ready : undefined; });
}
test("download opt-in enables both local roles only after synthetic probes", async () => {
  const commands: string[] = []; reset(commands);
  let started!: () => void, finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const entered = new Promise<void>((resolve) => { started = resolve; });
  runtime(async () => { started(); await pending; });
  const setup = startLocalSetup(); await entered;
  assert.equal(getState().settings.aiProvider, "off");
  assert.equal(getState().settings.localAI?.setupPending, true);
  finish(); await setup;
  assert.equal(getState().settings.aiProvider, "local");
  assert.equal(getState().settings.openaiKey, "saved-key");
  assert.equal(getState().settings.localAI?.setupPending, false);
  assert.match(getState().settings.localAI?.fingerprint ?? "", /clef-sha/);
  assert.ok(commands.includes("local_ai_install"));
  await stopLocalSetup();
});
test("cancelled probes cannot enable AI or load the second model", async () => {
  reset(); let entered!: () => void, finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const paths = runtime(async () => { entered(); await pending; });
  const setup = startLocalSetup(); await started;
  const stop = stopLocalSetup();
  setState({ settings: { ...getState().settings, aiProvider: "openai" } });
  finish(); await Promise.all([setup, stop]);
  assert.equal(getState().settings.aiProvider, "openai");
  assert.equal(paths.includes("/api/chat"), false);
  assert.equal(setupSnapshot().error, "");
});
test("failed setup remains off and reports the probe failure", async () => {
  reset(); runtime(undefined, true); await startLocalSetup();
  assert.equal(getState().settings.aiProvider, "off");
  assert.equal(getState().settings.localAI?.setupPending, false);
  assert.match(setupSnapshot().error, /missing or invalid/);
  await stopLocalSetup();
});
test("a managed marker cannot bypass version checks on an external runtime", async () => {
  reset(); overrideBridge(async () => ({ status: 200, body: JSON.stringify({ version: "b11535", wilmai_managed: true }) }));
  await assert.rejects(checkOllama({ ...DEFAULT_SETTINGS, localAI: { endpoint: "http://127.0.0.1:11434" } }), /or newer/);
  overrideBridge(null);
});
