import { bridgeCall } from "../wilma/transport";
import { getState, updateSettings } from "../data/store";
import { intelligenceOn, type Settings } from "../data/model";
import { MANAGED_ENDPOINT, LOCAL_CONTEXT, LOCAL_DECIDER, LOCAL_READER, LOCAL_MODEL_PROFILES, OLLAMA_MINIMUM, localEndpoint, ollamaEndpoint, providerIdentity, versionAtLeast } from "./config";
import { validateStructured } from "./schema";
import type { DecisionAnswer, DecisionQuestion } from "../luna/client";

export class LocalAIError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}

export async function ollamaRequest<T>(endpoint: string, path: string, body?: unknown): Promise<T> {
  const r = await bridgeCall<{ status: number; body: string }>("ollama", { body: { endpoint: ollamaEndpoint(endpoint), path, body } });
  let data: T & { error?: string };
  const runtime = endpoint === MANAGED_ENDPOINT ? "Local AI" : "Ollama";
  try { data = JSON.parse(r.body); } catch { throw new LocalAIError(`${runtime} returned an unreadable response.`); }
  if (r.status !== 200 || data.error) throw new LocalAIError(`${runtime}: ${data.error ?? `HTTP ${r.status}`}`, r.status >= 500);
  return data;
}

export interface OllamaStatus { version: string; fingerprint: string; bytes: number; models: { name: string; digest: string; size: number }[] }

/** Metadata only: checking readiness sends no school material and loads no model. */
export async function checkOllama(settings: Settings): Promise<OllamaStatus> {
  const endpoint = localEndpoint(settings);
  const { version, wilmai_engine, wilmai_managed } = await ollamaRequest<{ version: string; wilmai_engine?: string; wilmai_managed?: boolean }>(endpoint, "/api/version");
  if (!(endpoint === MANAGED_ENDPOINT && wilmai_managed === true) && !versionAtLeast(version)) throw new LocalAIError(`Ollama ${OLLAMA_MINIMUM} or newer is required; installed: ${version}.`);
  const { models } = await ollamaRequest<{ models: OllamaStatus["models"] }>(endpoint, "/api/tags");
  const wanted = [settings.localAI?.decisionModel ?? LOCAL_DECIDER, settings.localAI?.readingModel ?? LOCAL_READER];
  const selected = wanted.map((name) => models.find((m) => m.name.toLowerCase() === name.toLowerCase()));
  if (selected.some((m) => !m)) throw new LocalAIError(`Missing local models: ${wanted.filter((_, i) => !selected[i]).join(", ")}. Download and verify the local pack in Settings.`);
  for (const [i, model] of wanted.entries()) {
    const show = await ollamaRequest<{ capabilities: string[]; details: { format: string; quantization_level: string }; parameters?: string }>(endpoint, "/api/show", { model });
    if (!show.capabilities?.includes(i === 0 ? "decision" : "completion")) throw new LocalAIError(`${model} does not support ${i === 0 ? "decisions" : "text extraction"}.`);
    const quantization = i === 0 && model === LOCAL_MODEL_PROFILES.medium.decision ? "Q8_0" : "Q4_K_M";
    if (show.details?.format !== "gguf" || show.details.quantization_level !== quantization) throw new LocalAIError(`${model} must use ${quantization} GGUF weights for this local profile.`);
    if (i === 1 && !new RegExp(`num_ctx\\s+${LOCAL_CONTEXT}(?:\\s|$)`).test(show.parameters ?? "")) throw new LocalAIError(`${model} needs a ${LOCAL_CONTEXT}-token context. Download and verify the local pack in Settings.`);
  }
  const found = selected as OllamaStatus["models"];
  return { version, models: found, bytes: found.reduce((sum, m) => sum + m.size, 0), fingerprint: JSON.stringify([version, wilmai_engine ?? "stock Ollama", ...found.map((m) => [m.name, m.digest])]) };
}

// One request at a time across sorting, marks, extraction and verification.
// Only models loaded by this module are unloaded; other Ollama users' models are untouched.
let tail: Promise<unknown> = Promise.resolve();
let loaded: { endpoint: string; model: string } | null = null;
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work);
  tail = result.catch(() => undefined);
  return result;
}

async function unload(): Promise<void> {
  if (!loaded) return;
  const previous = loaded;
  await ollamaRequest(previous.endpoint, "/api/generate", { model: previous.model, keep_alive: 0 });
  // The unload acknowledgment can precede runner shutdown. Do not load its
  // replacement until the runtime confirms this model has left memory.
  for (let attempt = 0; attempt < 50; attempt++) {
    const { models } = await ollamaRequest<{ models: { name: string }[] }>(previous.endpoint, "/api/ps");
    if (!models.some((m) => m.name.toLowerCase() === previous.model.toLowerCase())) { loaded = null; return; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new LocalAIError("The previous local model did not leave memory; processing stopped.");
}
export const releaseLocalModels = () => serialized(unload);

/** Tiny synthetic requests catch runner incompatibilities that metadata cannot detect. */
export function probeOllama(settings: Settings, shouldContinue: () => boolean = () => true): Promise<void> {
  return serialized(async () => {
    const endpoint = localEndpoint(settings);
    const guard = () => { if (!shouldContinue()) throw new LocalAIError("The AI settings changed; setup stopped."); };
    try {
      guard();
      await unload();
      guard();
      const decision = settings.localAI?.decisionModel ?? LOCAL_DECIDER;
      loaded = { endpoint, model: decision };
      const q: DecisionQuestion = { type: "predicate", name: "finnish", instructions: "Is the text in Finnish?" };
      const result = await ollamaRequest<{ answers: Record<string, unknown> }>(endpoint, "/v1/systemone", { model: decision, state: "Hyvää huomenta!", questions: { finnish: systemOneQuestion(q) }, keep_alive: "5m" });
      systemOneAnswer(q, result.answers?.finnish);
      const resident = await ollamaRequest<{ models: { name: string; context_length: number }[] }>(endpoint, "/api/ps");
      const context = resident.models.find((m) => m.name.toLowerCase() === decision.toLowerCase())?.context_length;
      if (typeof context !== "number" || context < 4096 || context > LOCAL_CONTEXT) throw new LocalAIError(`Clef needs an Ollama context between 4096 and ${LOCAL_CONTEXT} tokens. Start Ollama with OLLAMA_CONTEXT_LENGTH=${LOCAL_CONTEXT} and OLLAMA_NUM_PARALLEL=1, then check again.`);
      await unload();
      guard();
      const reader = settings.localAI?.readingModel ?? LOCAL_READER;
      loaded = { endpoint, model: reader };
      const schema = { type: "object", required: ["maximum"], additionalProperties: false, properties: { maximum: { type: "string" } } };
      const read = await ollamaRequest<{ message: { content: string } }>(endpoint, "/api/chat", {
        model: reader, stream: false, think: false, format: schema, truncate: false, shift: false, keep_alive: "5m", options: { num_ctx: LOCAL_CONTEXT, num_predict: 256, temperature: 0 },
        messages: [{ role: "user", content: 'Read the maximum from the exam mark 24/25. Return JSON: {"maximum":"25"}.' }],
      });
      const value: unknown = JSON.parse(read.message.content);
      validateStructured(value, schema);
      if ((value as { maximum: string }).maximum !== "25") throw new LocalAIError("The local extraction model failed its setup check.");
    } finally { await unload(); }
  });
}

let preparedPack: string | null = null;
/** Reuse the successful Settings probe on the first actual reading. */
export function rememberLocalProbe(settings: Settings, status: OllamaStatus): void {
  preparedPack = JSON.stringify([localEndpoint(settings), status.fingerprint]);
}
let preparing: Promise<void> | null = null;
/** Refresh metadata on each run, and probe once per runtime/model pack per launch. */
export function prepareOllama(): Promise<void> {
  preparing ??= (async () => {
    const settings = getState().settings;
    const identity = providerIdentity(settings);
    const status = await checkOllama(settings);
    const pack = JSON.stringify([localEndpoint(settings), status.fingerprint]);
    if (preparedPack !== pack) await probeOllama(settings, () => intelligenceOn(getState().settings) && providerIdentity(getState().settings) === identity);
    if (!intelligenceOn(getState().settings) || providerIdentity(getState().settings) !== identity) throw new LocalAIError("The AI settings changed; local processing stopped.");
    if (settings.localAI?.fingerprint !== status.fingerprint) updateSettings({ localAI: { ...settings.localAI, fingerprint: status.fingerprint } });
    preparedPack = pack;
  })().finally(() => { preparing = null; });
  return preparing;
}

async function infer<T>(settings: Settings, model: string, path: string, body: Record<string, unknown>): Promise<T> {
  const identity = providerIdentity(settings);
  return serialized(async () => {
    if (!intelligenceOn(getState().settings) || providerIdentity(getState().settings) !== identity) throw new LocalAIError("The AI settings changed; local processing stopped.");
    const endpoint = localEndpoint(settings);
    if (loaded && (loaded.endpoint !== endpoint || loaded.model !== model)) await unload();
    loaded = { endpoint, model };
    return ollamaRequest<T>(endpoint, path, { ...body, model, keep_alive: "5m" });
  });
}

export function systemOneQuestion(q: DecisionQuestion): Record<string, unknown> {
  if (q.type === "predicate") return { type: "noul", instructions: q.instructions };
  if (q.type === "choice") return { type: "choice", instructions: q.instructions, criteria: Object.fromEntries(q.choices.map((c) => [c.value, c.description])) };
  return { type: "score", instructions: q.instructions, criteria: q.levels.map((l) => `${l.label}: ${l.description}`) };
}

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
export function decisionBatches(input: string, questions: DecisionQuestion[]): DecisionQuestion[][] {
  const batches: DecisionQuestion[][] = [];
  for (const q of questions) {
    if (q.type === "choice" && (q.choices.length < 1 || q.choices.length > 26)) throw new LocalAIError("A local choice needs between 1 and 26 options.");
    if (q.type === "score" && (q.levels.length < 2 || q.levels.length > 10)) throw new LocalAIError("A local score needs between 2 and 10 levels.");
    const size = (qs: DecisionQuestion[]) => bytes({ model: LOCAL_DECIDER, state: input, questions: Object.fromEntries(qs.map((x) => [x.name, systemOneQuestion(x)])), keep_alive: "5m" });
    const last = batches.at(-1);
    if (!last || last.length === 64 || size([...last, q]) > 60 * 1024) batches.push([q]);
    else last.push(q);
    if (size(batches.at(-1)!) > 60 * 1024) throw new LocalAIError("This item is too long for local decisions; it was not truncated.");
  }
  return batches;
}

function probability(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) throw new LocalAIError("Ollama returned an invalid probability.");
  return v;
}
export function systemOneAnswer(q: DecisionQuestion, value: unknown): DecisionAnswer {
  const a = value as Record<string, unknown> | undefined;
  if (!a || a.type !== (q.type === "predicate" ? "noul" : q.type)) throw new LocalAIError(`Ollama's answer was missing or invalid: ${q.name}.`);
  if (q.type === "predicate") return { type: "predicate", name: q.name, probability: probability(a.noul) };
  const ps = a.probabilities as Record<string, unknown> | undefined;
  const keys = q.type === "choice" ? q.choices.map((c) => c.value) : q.levels.map((_, i) => String(i));
  const probabilities = keys.map((key) => probability(ps?.[key]));
  if (Math.abs(probabilities.reduce((sum, p) => sum + p, 0) - 1) > 0.02) throw new LocalAIError("Ollama's probabilities did not add up to one.");
  const confidence = probability(a.confidence);
  if (q.type === "choice") {
    if (!keys.includes(String(a.choice))) throw new LocalAIError("Ollama chose an unknown option.");
    return { type: "choice", name: q.name, choice: String(a.choice), confidence, probabilities: keys.map((key, i) => ({ value: key, probability: probabilities[i] })) };
  }
  if (typeof a.score !== "number" || !Number.isFinite(a.score) || a.score < 0 || a.score > keys.length - 1) throw new LocalAIError("Ollama returned an invalid score.");
  return { type: "score", name: q.name, score: a.score, confidence, probabilities: q.levels.map((l, i) => ({ value: i, label: l.label, probability: probabilities[i] })) };
}

export async function decideLocally(input: string, questions: DecisionQuestion[]): Promise<Record<string, DecisionAnswer>> {
  const settings = getState().settings;
  const out: Record<string, DecisionAnswer> = {};
  for (const batch of decisionBatches(input, questions)) {
    const data = await infer<{ answers: Record<string, unknown> }>(settings, settings.localAI?.decisionModel ?? LOCAL_DECIDER, "/v1/systemone", { state: input, questions: Object.fromEntries(batch.map((q) => [q.name, systemOneQuestion(q)])) });
    for (const q of batch) out[q.name] = systemOneAnswer(q, data.answers?.[q.name]);
  }
  return out;
}

export async function readLocally<T>(opts: { instructions: string; input: string; schema: Record<string, unknown> }): Promise<T> {
  const settings = getState().settings;
  // A conservative UTF-8 upper bound leaves room for output and template tokens.
  // Reject oversized input rather than letting a chat runtime silently drop its beginning.
  if (bytes([opts.instructions, opts.input, opts.schema]) > LOCAL_CONTEXT - 4096 - 256) throw new LocalAIError("This item is too long for the local reading profile; it was not truncated.");
  const data = await infer<{ done_reason: string; message: { content: string }; done: boolean }>(settings, settings.localAI?.readingModel ?? LOCAL_READER, "/api/chat", {
    stream: false, think: settings.localAI?.think ?? true, format: opts.schema, truncate: false, shift: false,
    options: { num_ctx: LOCAL_CONTEXT, num_predict: 4096, temperature: 0 },
    messages: [{ role: "system", content: `${opts.instructions}\nReturn JSON matching this schema:\n${JSON.stringify(opts.schema)}` }, { role: "user", content: opts.input }],
  });
  if (!data.done || data.done_reason === "length") throw new LocalAIError("The local reading exceeded its output limit.");
  try {
    const value: unknown = JSON.parse(data.message.content);
    validateStructured(value, opts.schema);
    return value as T;
  } catch (e) { throw new LocalAIError(`The local reading did not match its schema: ${e instanceof Error ? e.message : String(e)}`); }
}
