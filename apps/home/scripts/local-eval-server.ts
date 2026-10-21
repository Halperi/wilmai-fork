/** Test-only supervisor: one native worker; Ollama supplies private model metadata. */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { LOCAL_CONTEXT, LOCAL_DECIDER, LOCAL_READER } from "../src/ai/config.ts";
import { forwardToOllama, readJson } from "../bridge/core.ts";

type Child = ReturnType<typeof spawn>;
type StopChild = (child: Child | undefined) => Promise<void>;
export const QWEN_TEMPLATE_SHA256 = "a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715";
export const REASONING_BUDGET = 512;
export const NATIVE_FINGERPRINT = `native Clef and Qwen via llama.cpp b11535 / f39148a95; Qwen template ${QWEN_TEMPLATE_SHA256}; reasoning budget ${REASONING_BUDGET}; Qwen batch 2048/512; text only; cache RAM 0`;

export async function localEvalServer(options: { ollama: string; engine: string; template: string; models: string; decisionModel?: string; readingModel?: string; signal: AbortSignal; terminate: StopChild }) {
  const decision = options.decisionModel ?? LOCAL_DECIDER;
  const reader = options.readingModel ?? LOCAL_READER;
  let worker: Child | undefined;
  let workerEndpoint = "";
  let workerModel = "";
  let loading: Promise<void> | null = null;
  let loadingModel = "";
  let workerSize = 0;
  let logs = "";
  const request = async (path: string, body?: unknown) => {
    const result = await forwardToOllama({ endpoint: options.ollama, path, body });
    if (result.status !== 200) throw new Error(`Ollama ${result.status}: ${result.body}`);
    return JSON.parse(result.body);
  };
  const running = () => worker && worker.exitCode === null && worker.signalCode === null;
  const stopWorker = async () => { await options.terminate(worker); worker = undefined; workerEndpoint = ""; workerModel = ""; };
  const loadWorker = async (model: string) => {
    if (loading) {
      if (loadingModel !== model) throw new Error("Another model is loading; refusing concurrent inference.");
      await loading;
      return;
    }
    if (running() && workerModel === model && workerEndpoint) return;
    if (running() && workerModel !== model) throw new Error("The previous model is still loaded; refusing concurrent inference.");
    loadingModel = model;
    loading ??= (async () => {
      options.signal.throwIfAborted();
      // Only our private Ollama store is used. Never unload a user's service.
      const resident = await request("/api/ps");
      if (resident.models.length) throw new Error("Ollama still has a loaded model; refusing concurrent inference.");
      const info = await request("/api/show", { model });
      const modelPath = /^FROM (.+)$/m.exec(info.modelfile)?.[1];
      if (!modelPath || !/^sha256-[a-f0-9]{64}$/.test(basename(modelPath)) || modelPath !== join(options.models, "blobs", basename(modelPath))) throw new Error("Weights are not in this run's private model directory.");
      workerSize = (await stat(modelPath)).size;
      const portProbe = createServer();
      await new Promise<void>((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
      const port = (portProbe.address() as { port: number }).port;
      await new Promise<void>((resolve, reject) => portProbe.close((e) => e ? reject(e) : resolve()));
      workerEndpoint = `http://127.0.0.1:${port}`;
      workerModel = model;
      logs = "";
      const env = { ...process.env };
      delete env.DYLD_LIBRARY_PATH; delete env.GGML_BACKEND_PATH;
      const readerArgs = model === reader ? ["--chat-template-file", options.template, "--jinja", "--reasoning-format", "deepseek", "--reasoning-budget", String(REASONING_BUDGET)] : [];
      // Clef scores the complete state in one encoder batch; autoregressive
      // Qwen can use small prompt batches and avoid large temporary buffers.
      const batch = model === reader ? "2048" : String(LOCAL_CONTEXT);
      const microBatch = model === reader ? "512" : String(LOCAL_CONTEXT);
      worker = spawn(options.engine, ["--model", modelPath, "--alias", model, "--host", "127.0.0.1", "--port", String(port), "--ctx-size", String(LOCAL_CONTEXT), "--batch-size", batch, "--ubatch-size", microBatch, "--parallel", "1", "--flash-attn", "on", "--cache-ram", "0", "--no-context-shift", "--offline", "--no-webui", ...readerArgs], { env, stdio: ["ignore", "ignore", "pipe"] });
      let failure: Error | null = null;
      worker.on("error", (e) => { failure = e; });
      worker.stderr?.on("data", (chunk: Buffer) => { logs = (logs + chunk.toString()).slice(-6000); });
      const deadline = Date.now() + 120_000;
      for (;;) {
        options.signal.throwIfAborted();
        if (failure) throw failure;
        if (!running()) throw new Error(`${model} stopped: ${logs}`);
        if (Date.now() > deadline) throw new Error(`${model} load timed out: ${logs}`);
        try { const health = await fetch(`${workerEndpoint}/health`, { signal: AbortSignal.any([options.signal, AbortSignal.timeout(1000)]), redirect: "error" }); if (health.ok) return; }
        catch { options.signal.throwIfAborted(); }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    })().catch(async (error) => { await stopWorker(); throw error; }).finally(() => { loading = null; loadingModel = ""; });
    await loading;
  };
  const gateway = createServer(async (req, res) => {
    try {
      const body = req.method === "POST" ? await readJson<Record<string, unknown>>(req) : undefined;
      const path = req.url ?? "";
      let result: unknown;
      if (path === "/v1/systemone" && body?.model === decision) {
        await loadWorker(decision);
        const response = await fetch(`${workerEndpoint}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([options.signal, AbortSignal.timeout(300_000)]), redirect: "error" });
        res.writeHead(response.status, { "content-type": "application/json" }); res.end(await response.text()); return;
      }
      if (path === "/api/chat" && body?.model === reader) {
        await loadWorker(reader);
        const generation = body.options as { num_predict: number; temperature: number };
        const response = await fetch(`${workerEndpoint}/v1/chat/completions`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: reader, messages: body.messages, stream: false, temperature: generation.temperature, max_tokens: generation.num_predict,
            chat_template_kwargs: { enable_thinking: body.think === true }, reasoning_budget_tokens: REASONING_BUDGET,
            response_format: { type: "json_schema", json_schema: { name: "extraction", schema: body.format } } }),
          signal: AbortSignal.any([options.signal, AbortSignal.timeout(300_000)]), redirect: "error",
        });
        if (!response.ok) { res.writeHead(response.status, { "content-type": "application/json" }); res.end(await response.text()); return; }
        const data = await response.json() as { choices: { finish_reason: string; message: { content: string; reasoning_content?: string } }[] };
        const choice = data.choices?.[0];
        if (!choice || typeof choice.message?.content !== "string" || !["stop", "length"].includes(choice.finish_reason)) throw new Error("Native Qwen returned an incomplete response.");
        result = { model: reader, done: true, done_reason: choice.finish_reason, message: { role: "assistant", content: choice.message.content, thinking: choice.message.reasoning_content ?? "" } };
      } else if (path === "/api/generate" && [decision, reader].includes(String(body?.model)) && body?.keep_alive === 0) { if (workerModel === body.model) await stopWorker(); result = { done: true }; }
      else if (path === "/api/ps") {
        result = await request(path);
        if (running()) (result as { models: unknown[] }).models.push({ name: workerModel, size: workerSize, context_length: LOCAL_CONTEXT });
      } else if (path === "/api/version") result = { ...await request(path), wilmai_engine: NATIVE_FINGERPRINT };
      else {
        if (path === "/api/chat" || path === "/v1/systemone" || path === "/api/generate") throw new Error("This test supervisor only serves its pinned Clef and Qwen models.");
        const response = await forwardToOllama({ endpoint: options.ollama, path, body });
        res.writeHead(response.status, { "content-type": "application/json" }); res.end(response.body); return;
      }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(result));
    } catch (e) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); }
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const port = (gateway.address() as { port: number }).port;
  const abort = () => { worker?.kill("SIGTERM"); gateway.closeAllConnections(); };
  options.signal.addEventListener("abort", abort, { once: true });
  return {
    endpoint: `http://127.0.0.1:${port}`,
    child: () => worker,
    close: async () => { options.signal.removeEventListener("abort", abort); gateway.closeAllConnections(); await new Promise<void>((resolve) => gateway.close(() => resolve())); await stopWorker(); },
  };
}
