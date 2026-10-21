import "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { forwardToOllama } from "../bridge/core.ts";
import { intelligenceOn, intelligenceProvider, DEFAULT_SETTINGS } from "../src/data/model.ts";
import { LOCAL_CONTEXT, LOCAL_DECIDER, LOCAL_READER, LOCAL_MODEL_PROFILES, localDecisions, localReading, ollamaEndpoint, providerIdentity, versionAtLeast } from "../src/ai/config.ts";
import { decisionBatches, systemOneAnswer, checkOllama, probeOllama, releaseLocalModels } from "../src/ai/ollama.ts";
import { validateStructured } from "../src/ai/schema.ts";
import { overrideBridge } from "../src/wilma/transport.ts";
import { getState, setState } from "../src/data/store.ts";
import { respond, decide, monthCost } from "../src/luna/client.ts";
import type { DecisionQuestion } from "../src/luna/client.ts";
import { loadCases, snapshotOf } from "./lib.ts";
import { runJev } from "../src/jev/runner.ts";
import { runLuna } from "../src/luna/events.ts";

test("explicit opt-in overrides saved keys and legacy installations retain their mode", () => {
  assert.equal(intelligenceProvider(DEFAULT_SETTINGS), "off");
  assert.equal(intelligenceProvider({ ...DEFAULT_SETTINGS, openaiKey: "existing" }), "openai");
  assert.equal(intelligenceOn({ ...DEFAULT_SETTINGS, openaiKey: "existing", aiProvider: "off" }), false);
  assert.equal(intelligenceOn({ ...DEFAULT_SETTINGS, aiProvider: "local" }), true);
  // A saved per-role model field cannot create mixed local/cloud processing.
  for (const aiProvider of ["off", "openai", "local"] as const) {
    const settings = { ...DEFAULT_SETTINGS, aiProvider, decider: "local" as const, readingModel: LOCAL_READER };
    assert.equal(localDecisions(settings), aiProvider === "local");
    assert.equal(localReading(settings), aiProvider === "local");
  }
});

test("local connections are limited to loopback origins and stable supported versions", () => {
  assert.equal(ollamaEndpoint("http://127.0.0.1:11435/"), "http://127.0.0.1:11435");
  assert.equal(ollamaEndpoint("http://[::1]:11434"), "http://[::1]:11434");
  for (const url of ["https://127.0.0.1", "http://localhost", "http://127.0.0.1.evil.test", "http://example.com", "http://user:pw@127.0.0.1", "http://127.0.0.1/path", "http://127.0.0.1?x=1"]) assert.throws(() => ollamaEndpoint(url));
  assert.equal(versionAtLeast("0.34.3"), false);
  assert.equal(versionAtLeast("0.35.1"), true);
  assert.equal(versionAtLeast("0.40.2"), true);
  assert.equal(versionAtLeast("0.35.1-rc1"), false);
});

test("model digest, thinking and provider changes invalidate caches", () => {
  const s = { ...DEFAULT_SETTINGS, aiProvider: "local" as const, localAI: { fingerprint: "weights-a", think: true } };
  for (const change of [{ fingerprint: "weights-b" }, { think: false }, { endpoint: "http://127.0.0.1:11435" }]) assert.notEqual(providerIdentity(s), providerIdentity({ ...s, localAI: { ...s.localAI, ...change } }));
  assert.notEqual(providerIdentity(s), providerIdentity({ ...s, aiProvider: "openai" }));
});

test("large decision sets are batched without losing or truncating questions", () => {
  const qs = Array.from({ length: 130 }, (_, i): DecisionQuestion => ({ type: "predicate", name: `q${i}`, instructions: `Is item ${i} relevant?` }));
  const batches = decisionBatches("Koulun tiedote", qs);
  assert.deepEqual(batches.map((b) => b.length), [64, 64, 2]);
  assert.deepEqual(batches.flat(), qs);
  const long = qs.map((q) => ({ ...q, instructions: "ä".repeat(2000) }));
  assert.ok(decisionBatches("Koulun tiedote", long).every((b) => b.length < 64));
  assert.throws(() => decisionBatches("a".repeat(70_000), qs), /not truncated/);
  const score: DecisionQuestion = { type: "score", name: "score", instructions: "How urgent?", levels: Array.from({ length: 11 }, (_, i) => ({ label: String(i), description: `Level ${i}` })) };
  assert.throws(() => decisionBatches("Text", [score]), /2 and 10/);
  assert.throws(() => decisionBatches("Text", [{ ...score, levels: score.levels.slice(0, 1) }]), /2 and 10/);
  assert.throws(() => decisionBatches("Text", [{ type: "choice", name: "choice", instructions: "Which?", choices: [] }]), /1 and 26/);
});

test("typed decisions reject missing probabilities, wrong types and unknown choices", () => {
  const predicate: DecisionQuestion = { type: "predicate", name: "needed", instructions: "Required?" };
  assert.deepEqual(systemOneAnswer(predicate, { type: "noul", noul: 0.8 }), { type: "predicate", name: "needed", probability: 0.8 });
  assert.throws(() => systemOneAnswer(predicate, { type: "noul", noul: 1.1 }));
  assert.throws(() => systemOneAnswer(predicate, undefined));
  const choice: DecisionQuestion = { type: "choice", name: "pupil", instructions: "Whose?", choices: [{ value: "a", description: "Aino" }, { value: "b", description: "Veeti" }] };
  assert.throws(() => systemOneAnswer(choice, { type: "choice", choice: "a", probabilities: { a: 1 }, confidence: 1 }));
  assert.throws(() => systemOneAnswer(choice, { type: "choice", choice: "c", probabilities: { a: 0.5, b: 0.5 }, confidence: 0 }));
  assert.equal(systemOneAnswer(choice, { type: "choice", choice: "a", probabilities: { a: 0.9, b: 0.1 }, confidence: 0.7 }).type, "choice");
  const score: DecisionQuestion = { type: "score", name: "urgent", instructions: "Urgency?", levels: [{ label: "low", description: "Can wait" }, { label: "high", description: "Today" }] };
  const answer = systemOneAnswer(score, { type: "score", score: 0.75, confidence: 0.5, probabilities: { 0: 0.25, 1: 0.75 } });
  assert.equal(answer.type, "score");
  assert.throws(() => systemOneAnswer(score, { type: "score", score: 2, confidence: 0.5, probabilities: { 0: 0.25, 1: 0.75 } }));
});

const schema = { type: "object", required: ["maximum"], additionalProperties: false, properties: { maximum: { type: ["string", "null"] } } };
test("extraction validates nullable fields, required fields and unexpected fields", () => {
  validateStructured({ maximum: null }, schema);
  validateStructured({ maximum: "25" }, schema);
  assert.throws(() => validateStructured({}, schema));
  assert.throws(() => validateStructured({ maximum: 25 }, schema));
  assert.throws(() => validateStructured({ maximum: "25", extra: true }, schema));
});

test("local inference never sends a saved cloud key and bypasses the cloud spending cap", async () => {
  const calls: { path: string; wire: Record<string, unknown> }[] = [];
  setState({ settings: { ...DEFAULT_SETTINGS, aiProvider: "local", openaiKey: "cloud-key-never-sent" }, usage: { [new Date().toISOString().slice(0, 7)]: { decisions: { calls: 1, input: 1e9, estimated: false }, items: 1 } } });
  const before = monthCost();
  overrideBridge(async (path, init) => {
    assert.equal(path, "ollama");
    assert.equal(JSON.stringify(init).includes("cloud-key-never-sent"), false);
    const wire = init.body as { path: string; body: Record<string, unknown> };
    calls.push({ path: wire.path, wire: wire.body });
    if (wire.path === "/v1/systemone") return { status: 200, body: JSON.stringify({ answers: { finnish: { type: "noul", noul: 0.99 } } }) };
    if (wire.path === "/api/chat") return { status: 200, body: JSON.stringify({ done: true, done_reason: "stop", message: { content: '{"maximum":"25"}' } }) };
    if (wire.path === "/api/ps") return { status: 200, body: '{"models":[]}' };
    return { status: 200, body: "{}" };
  });
  try {
    await decide("Hyvää huomenta", [{ name: "finnish", type: "predicate", instructions: "Finnish?" }]);
    assert.deepEqual(await respond({ name: "mark", instructions: "Read maximum", input: "24/25", schema }), { maximum: "25" });
    assert.deepEqual(calls.map((c) => c.path), ["/v1/systemone", "/api/generate", "/api/ps", "/api/chat"]);
    assert.equal(monthCost(), before);
    await releaseLocalModels();
    const beforeOversized = calls.length;
    await assert.rejects(respond({ name: "mark", instructions: "Read", input: "a".repeat(LOCAL_CONTEXT), schema }), /not truncated/);
    assert.equal(calls.length, beforeOversized, "oversized text never reaches the runtime");
    setState({ settings: { ...getState().settings, aiProvider: "off" } });
    const count = calls.length;
    await assert.rejects(respond({ name: "mark", instructions: "Read", input: "24/25", schema }));
    assert.equal(calls.length, count);
  } finally { await releaseLocalModels(); overrideBridge(null); }
});

test("readiness checks require Q4 models with the bounded context", async () => {
  const settings = { ...DEFAULT_SETTINGS, localAI: { decisionModel: "decision", readingModel: "reading" } };
  overrideBridge(async (_, init) => {
    const wire = init.body as { path: string; body: { model: string } };
    const value = wire.path === "/api/version" ? { version: "0.40.2" } : wire.path === "/api/tags" ? { models: [{ name: "decision", digest: "a", size: 6 }, { name: "reading", digest: "b", size: 3 }] } : { capabilities: [wire.body.model === "decision" ? "decision" : "completion"], details: { format: "gguf", quantization_level: "Q4_K_M" }, parameters: `num_ctx ${LOCAL_CONTEXT}` };
    return { status: 200, body: JSON.stringify(value) };
  });
  try { assert.equal((await checkOllama(settings)).bytes, 9); }
  finally { overrideBridge(null); }
});

test("Medium readiness requires Clef Q8 and a Q4 reader without weakening Small checks", async () => {
  const pack = LOCAL_MODEL_PROFILES.medium;
  const settings = { ...DEFAULT_SETTINGS, localAI: { decisionModel: pack.decision, readingModel: pack.reading } };
  let decisionQuantization = "Q8_0", readingQuantization = "Q4_K_M";
  overrideBridge(async (_, init) => {
    const wire = init.body as { path: string; body: { model: string } };
    const decision = wire.body?.model === pack.decision;
    const value = wire.path === "/api/version" ? { version: "0.40.2" }
      : wire.path === "/api/tags" ? { models: [{ name: pack.decision, digest: "q8", size: 10 }, { name: pack.reading, digest: "q4", size: 6 }] }
      : { capabilities: [decision ? "decision" : "completion"], details: { format: "gguf", quantization_level: decision ? decisionQuantization : readingQuantization }, parameters: `num_ctx ${LOCAL_CONTEXT}` };
    return { status: 200, body: JSON.stringify(value) };
  });
  try {
    assert.equal((await checkOllama(settings)).bytes, 16);
    decisionQuantization = "Q4_K_M";
    await assert.rejects(checkOllama(settings), /must use Q8_0/);
    decisionQuantization = "Q8_0"; readingQuantization = "Q8_0";
    await assert.rejects(checkOllama(settings), /must use Q4_K_M/);
  } finally { overrideBridge(null); }
});

test("the app pipeline uses extraction and verification phases with no cloud calls", async () => {
  const c = loadCases(new URL("./cases", import.meta.url).pathname).find((c) => c.id === "relative-tomorrow")!;
  c.items.push({ ...c.items[0], id: 802 });
  setState({ snapshot: snapshotOf(c), settings: { ...DEFAULT_SETTINGS, aiProvider: "local", decider: "jev", jevKey: "old-jev-key-never-sent", localAI: { think: false } }, jev: {}, luna: {}, jevBaseline: {}, usage: {} });
  const requests: string[] = [];
  let residentModel: string | null = null;
  overrideBridge(async (path, init) => {
    assert.equal(path, "ollama");
    const wire = init.body as { path: string; body: { model: string; format?: { properties?: { maximum?: unknown } }; questions: Record<string, { type: string; criteria?: string[] | Record<string, string> }> } };
    requests.push(wire.path);
    if (["/v1/systemone", "/api/chat"].includes(wire.path)) residentModel = wire.body.model;
    if (wire.path === "/api/generate") residentModel = null;
    const metadata = wire.path === "/api/version" ? { version: "0.40.2" }
      : wire.path === "/api/tags" ? { models: [{ name: LOCAL_DECIDER, digest: "decisions-v1", size: 7e9 }, { name: LOCAL_READER, digest: "reading-v1", size: 3e9 }] }
      : wire.path === "/api/show" ? { capabilities: [wire.body.model === LOCAL_DECIDER ? "decision" : "completion"], details: { format: "gguf", quantization_level: "Q4_K_M" }, parameters: `num_ctx ${LOCAL_CONTEXT}` }
      : wire.path === "/api/ps" ? { models: residentModel ? [{ name: residentModel, context_length: LOCAL_CONTEXT }] : [] } : null;
    if (metadata) return { status: 200, body: JSON.stringify(metadata) };
    if (wire.path === "/api/chat") return { status: 200, body: JSON.stringify({ done: true, done_reason: "stop", message: { content: JSON.stringify(wire.body.format?.properties?.maximum ? { maximum: "25" } : { action: { quote: null, title: null, deadline: null }, events: [{ quote: "Huomenna koulu alkaa vasta klo 10.15 opettajien koulutuspäivän vuoksi.", date: "2026-10-09", end_date: null, start: "10:15", end: null, title: "Koulun myöhäisempi alku", kind: "schedule", for_whom: "pupils_class", pupils: [] }] }) } }) };
    if (wire.path === "/v1/systemone" && Object.keys(wire.body.questions).some((q) => q.startsWith("calendar_"))) requests.push("verification");
    const answers = Object.fromEntries(Object.entries(wire.body?.questions ?? {}).map(([key, q]) => {
      if (q.type === "noul") return [key, { type: "noul", noul: 0 }];
      const keys = Array.isArray(q.criteria) ? q.criteria.map((_, i) => String(i)) : Object.keys(q.criteria!);
      const probabilities = Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0]));
      return [key, { type: q.type, choice: keys[0], score: 0, confidence: 1, probabilities }];
    }));
    return { status: 200, body: JSON.stringify({ answers }) };
  });
  try {
    await runJev(); await runLuna();
    assert.equal(getState().lunaStatus.error, null);
    assert.equal(getState().jevStatus.error, null);
    assert.equal(Object.values(getState().luna).length, 2);
    assert.equal(Object.values(getState().luna)[0].model, LOCAL_READER);
    assert.match(getState().settings.localAI?.fingerprint ?? "", /decisions-v1/);
    assert.ok(requests.includes("/api/chat"));
    assert.ok(requests.indexOf("verification") > requests.lastIndexOf("/api/chat"), "all items are extracted before any calendar verification");
    assert.equal(residentModel, null, "the final model is unloaded");
  } finally { await releaseLocalModels(); overrideBridge(null); }
});

test("a failed runtime probe unloads the model and never enables intelligence", async () => {
  const settings = { ...DEFAULT_SETTINGS, aiProvider: "off" as const };
  setState({ settings });
  const requests: string[] = [];
  overrideBridge(async (_, init) => {
    const wire = init.body as { path: string };
    requests.push(wire.path);
    return wire.path === "/v1/systemone" ? { status: 500, body: '{"error":"unknown model architecture"}' } : { status: 200, body: wire.path === "/api/ps" ? '{"models":[]}' : "{}" };
  });
  try {
    await assert.rejects(probeOllama(settings), /unknown model architecture/);
    assert.deepEqual(requests, ["/v1/systemone", "/api/generate", "/api/ps"]);
    assert.equal(intelligenceOn(getState().settings), false);
  } finally { await releaseLocalModels(); overrideBridge(null); }
});

test("the real local HTTP transport sends no authorization and never follows redirects", async () => {
  let redirectsFollowed = 0;
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    if (req.url === "/target") redirectsFollowed++;
    res.writeHead(req.url === "/api/chat" ? 302 : 200, { location: "/target", "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await forwardToOllama({ endpoint, path: "/api/chat", body: { model: LOCAL_READER } })).status, 302);
    assert.equal(redirectsFollowed, 0);
    await assert.rejects(forwardToOllama({ endpoint, path: "/api/pull", body: { model: "unrequested" } }));
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
