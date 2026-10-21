import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localEvalServer, REASONING_BUDGET } from "../scripts/local-eval-server.ts";
import { LOCAL_CONTEXT, LOCAL_MODEL_PROFILES } from "../src/ai/config.ts";

for (const [profile, pack] of Object.entries(LOCAL_MODEL_PROFILES)) test(`native ${profile} supervisor constrains extraction and reaps each worker before a model switch`, async () => {
  const root = await mkdtemp(join(tmpdir(), "wilmai-supervisor-test-"));
  const models = join(root, "models");
  await mkdir(join(models, "blobs"), { recursive: true });
  const modelPath = join(models, "blobs", `sha256-${"a".repeat(64)}`);
  await writeFile(modelPath, "test fixture, no model weights");
  const engine = join(root, "fake-engine.cjs");
  await writeFile(engine, `#!/usr/bin/env node
const http = require('node:http');
const args = process.argv.slice(2);
const model = args[args.indexOf('--alias') + 1];
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
  res.setHeader('content-type', 'application/json');
  if (req.url === '/health') res.end('{}');
  else if (req.url === '/v1/chat/completions') res.end(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({request: body, args}), reasoning_content: body.chat_template_kwargs.enable_thinking ? 'brief reasoning' : ''}}]}));
  else res.end(JSON.stringify({model, answers: {finnish: {type: 'noul', noul: 0.9}}}));
});
server.listen(Number(args[args.indexOf('--port') + 1]), '127.0.0.1');
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
`, { mode: 0o700 });
  const ollama = createServer(async (req, res) => {
    for await (const _ of req) { /* discard the metadata request */ }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/api/show" ? { modelfile: `FROM ${modelPath}` } : req.url === "/api/version" ? { version: "0.40.2" } : { models: [] }));
  });
  await new Promise<void>((resolve) => ollama.listen(0, "127.0.0.1", resolve));
  const abort = new AbortController();
  let gateway: Awaited<ReturnType<typeof localEvalServer>> | undefined;
  try {
    gateway = await localEvalServer({
      ollama: `http://127.0.0.1:${(ollama.address() as { port: number }).port}`, engine, template: join(root, "template"), models, decisionModel: pack.decision, readingModel: pack.reading, signal: abort.signal,
      terminate: async (child) => {
        if (!child || child.exitCode !== null || child.signalCode !== null) return;
        const closed = once(child, "close"); child.kill("SIGTERM"); await closed;
      },
    });
    const call = async (path: string, body?: unknown) => {
      const response = await fetch(`${gateway!.endpoint}${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, body: await response.json() as any };
    };
    const chat = { model: pack.reading, think: true, stream: false, format: { type: "object" }, options: { num_ctx: LOCAL_CONTEXT, num_predict: 4096, temperature: 0 }, messages: [{ role: "user", content: "synthetic" }] };
    const read = await call("/api/chat", chat);
    assert.equal(read.status, 200);
    assert.equal(read.body.message.thinking, "brief reasoning");
    const echoed = JSON.parse(read.body.message.content);
    assert.equal(echoed.request.model, pack.reading);
    assert.equal(echoed.request.reasoning_budget_tokens, REASONING_BUDGET);
    assert.equal(echoed.request.max_tokens, 4096);
    assert.deepEqual(echoed.request.response_format.json_schema.schema, chat.format);
    for (const [flag, value] of [["--cache-ram", "0"], ["--ctx-size", "16384"], ["--batch-size", "2048"], ["--ubatch-size", "512"]]) assert.equal(echoed.args[echoed.args.indexOf(flag) + 1], value);
    assert.ok(echoed.args.includes("--no-context-shift"));
    const first = gateway.child()!;
    assert.equal((await call("/v1/systemone", { model: pack.decision })).status, 500);
    assert.equal(gateway.child(), first);
    await call("/api/generate", { model: pack.reading, keep_alive: 0 });
    assert.ok(first.exitCode !== null || first.signalCode !== null);
    assert.equal(gateway.child(), undefined);
    assert.deepEqual((await call("/api/ps")).body.models, []);
    const decide = await call("/v1/systemone", { model: pack.decision });
    assert.equal(decide.status, 200);
    assert.notEqual(gateway.child()!.pid, first.pid);
    assert.equal((await call("/api/ps")).body.models.length, 1);
    await call("/api/generate", { model: pack.decision, keep_alive: 0 });
    const fast = await call("/api/chat", { ...chat, think: false });
    assert.equal(fast.body.message.thinking, "");
  } finally {
    await gateway?.close();
    ollama.closeAllConnections(); await new Promise<void>((resolve) => ollama.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
