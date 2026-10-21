/* Temporary Ollama, temporary models, synthetic cases. Always clean up this run's files. */
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, mkdir, readFile, writeFile, stat, statfs } from "node:fs/promises";
import { tmpdir, totalmem, platform, arch } from "node:os";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { LOCAL_CONTEXT, LOCAL_MODEL_PROFILES, versionAtLeast, type LocalModelProfile } from "../src/ai/config.ts";
import { localEvalServer, NATIVE_FINGERPRINT, QWEN_TEMPLATE_SHA256 } from "./local-eval-server.ts";

const exec = promisify(execFile);
const cwd = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const runtimeIndex = args.indexOf("--runtime");
let runtime = runtimeIndex >= 0 ? args[runtimeIndex + 1] : "";
if (runtimeIndex >= 0 && (!runtime || runtime.startsWith("--"))) throw new Error("--runtime needs an Ollama executable path");
const forwarded = args.filter((_, i) => runtimeIndex < 0 || (i !== runtimeIndex && i !== runtimeIndex + 1));
if (forwarded.some((arg) => ["--check", "--summarize", "--accept"].includes(arg))) throw new Error("Use pnpm eval for offline checks and reports; they need no model downloads.");
const configIndex = forwarded.indexOf("--config");
const configNames = configIndex < 0 ? ["clef-qwen4-q4"] : (forwarded[configIndex + 1] ?? "").split(",").filter(Boolean);
const configurations = JSON.parse(await readFile(join(cwd, "evals", "configs.json"), "utf8")) as Record<string, { localDecisions?: boolean; localReading?: boolean; localProfile?: LocalModelProfile }>;
if (!configNames.length) throw new Error("--config needs a local eval configuration.");
for (const name of configNames) if (!configurations[name]?.localDecisions || !configurations[name]?.localReading) throw new Error(`${name}: the isolated helper requires a fully local eval configuration.`);
const profiles = [...new Set(configNames.map((name) => configurations[name].localProfile ?? "small"))];
if (profiles.length !== 1 || !LOCAL_MODEL_PROFILES[profiles[0]]) throw new Error("Run one supported local model pack at a time.");
const profileName = profiles[0];
const profile = LOCAL_MODEL_PROFILES[profileName];
const root = await mkdtemp(join(tmpdir(), "wilmai-local-eval-"));
const abort = new AbortController();
let server: ReturnType<typeof spawn> | undefined;
let evaluation: ReturnType<typeof spawn> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let gateway: Awaited<ReturnType<typeof localEvalServer>> | undefined;
let nativeEngine = "";
let qwenTemplate = "";
let exitCode = 1;
const metrics = { at: new Date().toISOString(), profile: profileName, textWeightBytes: profile.decisionWeights.bytes + profile.readingWeights.bytes, platform: platform(), arch: arch(), ramBytes: totalmem(), peakOllamaRssBytes: 0, peakLoadedModelBytes: 0, maximumLoadedModels: 0, swapBefore: "", swapAfter: "", runtime: "", runnerNote: process.env.WILMAI_LOCAL_RUNNER_NOTE ?? "stock Ollama runtime", models: [] as unknown[], cleaned: false };
let forcedStop: ReturnType<typeof setTimeout> | undefined;
const stop = () => {
  abort.abort();
  evaluation?.kill("SIGTERM");
  server?.kill("SIGTERM");
  // Some streaming clients do not unblock promptly on AbortSignal alone.
  forcedStop ??= setTimeout(() => { evaluation?.kill("SIGKILL"); server?.kill("SIGKILL"); }, 5000);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function terminate(child: ReturnType<typeof spawn> | undefined) {
  if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  child.kill("SIGTERM");
  const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
  try { await closed; } finally { clearTimeout(kill); }
}
const swap = async () => platform() === "darwin" ? (await exec("sysctl", ["-n", "vm.swapusage"])).stdout.trim() : "unavailable";

/** Pin official release assets, including the Clef-capable inference engine. */
async function prepareRuntime(): Promise<string> {
  if (platform() !== "darwin" || arch() !== "arm64") throw new Error("The managed test runtime currently supports Apple Silicon Macs only. Use --runtime for another platform.");
  const directory = join(root, "runtime");
  await mkdir(directory);
  const download = async (url: string, digest: string, file: string) => {
    const response = await fetch(url, { signal: abort.signal });
    if (!response.ok) throw new Error(`Runtime download failed: HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(data).digest("hex") !== digest) throw new Error("Runtime checksum did not match the pinned release.");
    await writeFile(file, data);
  };
  console.log("Preparing temporary Ollama 0.40.2 with Clef-capable llama.cpp b11535…");
  const ollamaArchive = join(directory, "ollama.tgz");
  await download("https://github.com/ollama/ollama/releases/download/v0.40.2/ollama-darwin.tgz", "e888b7637291ceb80b622c00ea067f62c86d9c50d419b3eb903032e4f1f8a4f6", ollamaArchive);
  await exec("tar", ["-xzf", ollamaArchive, "-C", directory]);
  const engineArchive = join(directory, "llama.tgz");
  await download("https://github.com/ggml-org/llama.cpp/releases/download/b11535/llama-b11535-bin-macos-arm64.tar.gz", "69437c84cc39e7bef5fbee2a8c3e9efdb4b3f9ba0bd889d6fdce0350c5dca58d", engineArchive);
  await exec("tar", ["-xzf", engineArchive, "-C", directory]);
  qwenTemplate = join(directory, "qwen-chat-template.jinja");
  await download(profile.templateURL, QWEN_TEMPLATE_SHA256, qwenTemplate);
  // No vision projectors or Ollama inference workers are started.
  nativeEngine = join(directory, "llama-b11535", "llama-server");
  await rm(ollamaArchive); await rm(engineArchive);
  metrics.runnerNote = `${NATIVE_FINGERPRINT}; private downloads/metadata via Ollama 0.40.2`;
  return join(directory, "ollama");
}

try {
  const space = await statfs(root);
  if (space.bavail * space.bsize < profile.minimumDiskGiB * 1024 ** 3) throw new Error(`${profileName} local evals need at least ${profile.minimumDiskGiB} GiB free temporary disk space.`);
  if (!runtime) runtime = await prepareRuntime();
  abort.signal.throwIfAborted();
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const endpoint = `http://127.0.0.1:${port}`;
  const env = { ...process.env, OLLAMA_HOST: endpoint, OLLAMA_MODELS: join(root, "models"), OLLAMA_NO_CLOUD: "1", OLLAMA_CONTEXT_LENGTH: String(LOCAL_CONTEXT), OLLAMA_NUM_PARALLEL: "1", OLLAMA_MAX_LOADED_MODELS: "1", OLLAMA_KEEP_ALIVE: "5m" };
  console.log(`Isolated local eval at ${endpoint}; models in ${root}. This folder is removed on completion or cancellation.`);
  server = spawn(runtime, ["serve"], { env, stdio: ["ignore", "ignore", "pipe"] });
  let serverError = "";
  server.stderr?.on("data", (chunk: Buffer) => { serverError = (serverError + chunk.toString()).slice(-6000); });
  let spawnError: Error | null = null;
  server.on("error", (e) => { spawnError = e; });
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(`${endpoint}${path}`, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" }, redirect: "error", signal: abort.signal });
    if (!response.ok) throw new Error(`Ollama ${response.status}: ${await response.text()}`);
    return response;
  };
  let version = "";
  for (let i = 0; i < 100 && !version; i++) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Ollama stopped: ${serverError}`);
    abort.signal.throwIfAborted();
    try { version = ((await (await request("/api/version")).json()) as { version: string }).version; }
    catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  if (!versionAtLeast(version)) throw new Error(`Ollama 0.35.1 or newer is required (found ${version || "no server"}). Use --runtime /path/to/a/current/ollama; the installed app is left unchanged.`);
  metrics.runtime = version;
  metrics.swapBefore = await swap();
  for (const [base, alias, weights] of [[profile.decision, profile.decision, profile.decisionWeights], [profile.readingBase, profile.reading, profile.readingWeights]] as const) {
    console.log(`Downloading ${base}…`);
    const response = await request("/api/pull", { model: base, stream: true });
    let pending = "", last = "";
    const decoder = new TextDecoder();
    for await (const chunk of response.body!) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines.filter(Boolean)) {
        const update = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string };
        if (update.error) throw new Error(update.error);
        const progress = update.total ? `${Math.floor(5 * (update.completed ?? 0) / update.total) * 20}%` : update.status ?? "";
        if (progress !== last) { console.log(`${base}: ${progress}`); last = progress; }
      }
    }
    if (alias !== base) {
      const created = await (await request("/api/create", { model: alias, from: base, parameters: { num_ctx: LOCAL_CONTEXT }, stream: false })).json() as { error?: string };
      if (created.error) throw new Error(created.error);
    }
    // Ollama verifies downloaded content hashes. Also require the exact pinned
    // text blob and byte count, rather than accepting whatever a tag now names.
    const info = await (await request("/api/show", { model: alias })).json() as { modelfile: string };
    const modelPath = /^FROM (.+)$/m.exec(info.modelfile)?.[1];
    const expectedPath = join(root, "models", "blobs", `sha256-${weights.sha256}`);
    if (modelPath !== expectedPath || (await stat(expectedPath)).size !== weights.bytes) throw new Error(`${base}: downloaded text weights do not match this profile's pin.`);
  }
  metrics.models = ((await (await request("/api/tags")).json()) as { models: unknown[] }).models;
  if (nativeEngine) gateway = await localEvalServer({ ollama: endpoint, engine: nativeEngine, template: qwenTemplate, models: join(root, "models"), decisionModel: profile.decision, readingModel: profile.reading, signal: abort.signal, terminate });
  const inferenceEndpoint = gateway?.endpoint ?? endpoint;
  let monitoring = false;
  const measure = async () => {
    if (monitoring || abort.signal.aborted) return;
    monitoring = true;
    try {
      const ps = await (await fetch(`${inferenceEndpoint}/api/ps`, { signal: abort.signal })).json() as { models: { size: number }[] };
      metrics.maximumLoadedModels = Math.max(metrics.maximumLoadedModels, ps.models.length);
      metrics.peakLoadedModelBytes = Math.max(metrics.peakLoadedModelBytes, ps.models.reduce((sum, m) => sum + m.size, 0));
      const rows = (await exec("ps", ["-axo", "pid=,ppid=,rss="])).stdout.trim().split("\n").map((r) => r.trim().split(/\s+/).map(Number));
      const pids = new Set([server!.pid, gateway?.child()?.pid].filter((p): p is number => p !== undefined));
      for (let change = true; change;) {
        change = false;
        for (const [pid, parent] of rows) if (pids.has(parent) && !pids.has(pid)) { pids.add(pid); change = true; }
      }
      metrics.peakOllamaRssBytes = Math.max(metrics.peakOllamaRssBytes, rows.filter(([pid]) => pids.has(pid)).reduce((sum, r) => sum + r[2] * 1024, 0));
    } catch { /* A load/unload can briefly leave no running model to sample. */ }
    finally { monitoring = false; }
  };
  timer = setInterval(() => void measure(), 1000);
  const evalArgs = forwarded.includes("--config") ? forwarded : ["--config", "clef-qwen4-q4", ...forwarded];
  evaluation = spawn(process.execPath, ["--import", "tsx", "evals/run.ts", ...evalArgs], { cwd, env: { ...process.env, OPENAI_API_KEY: "", JEV_API_KEY: "", WILMAI_OLLAMA_URL: inferenceEndpoint }, stdio: "inherit" });
  const [code] = await once(evaluation, "close");
  await measure();
  metrics.swapAfter = await swap();
  if (metrics.maximumLoadedModels > 1) throw new Error(`More than one model was loaded at once; the ${profileName} profile did not hold.`);
  exitCode = typeof code === "number" ? code : 1;
  if (exitCode !== 0) console.error(`Ollama diagnostics:\n${serverError}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
} finally {
  abort.abort();
  if (timer) clearInterval(timer);
  await terminate(evaluation);
  await gateway?.close();
  await terminate(server);
  if (forcedStop) clearTimeout(forcedStop);
  await rm(root, { recursive: true, force: true });
  metrics.cleaned = true;
  const reports = join(cwd, "evals", "results");
  await mkdir(reports, { recursive: true });
  await writeFile(join(reports, "local-hardware-latest.json"), JSON.stringify(metrics, null, 2) + "\n");
  await writeFile(join(reports, `local-hardware-${profileName}.json`), JSON.stringify(metrics, null, 2) + "\n");
  console.log(`Cleaned ${root}: runtime stopped and all temporary model files removed.`);
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
process.exitCode = exitCode;
