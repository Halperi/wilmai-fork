/** Build-time assets only. Models are downloaded by the app after user opt-in. */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rm, access, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pack = JSON.parse(await readFile(join(root, "src-tauri/resources/local-ai-pack.json"), "utf8"));
const dest = join(root, "src-tauri/resources/local-ai");
const stamp = join(dest, "prepared.json");
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY ?? "-";
if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("The bundled local runtime currently requires an Apple Silicon Mac.");
// Self-signed local certificates have no Apple Team ID, so enabling library
// validation on their workers prevents loading even the matching local dylibs.
let developerId = signingIdentity.startsWith("Developer ID Application:");
if (/^[a-f0-9]{40}$/i.test(signingIdentity)) {
  const identities = (await exec("security", ["find-identity", "-v", "-p", "codesigning"])).stdout;
  developerId = identities.split("\n").some((line) => line.toLowerCase().includes(signingIdentity.toLowerCase()) && line.includes('"Developer ID Application:'));
}
const identity = JSON.stringify(["signing-v2", pack.id, pack.runtime.sha256, pack.template.sha256, signingIdentity, developerId]);
try {
  if ((await readFile(stamp, "utf8")) === identity) {
    await access(join(dest, `llama-${pack.runtime.version}`, "llama-server"));
    console.log(`Local runtime ${pack.runtime.version} is prepared. No model downloads.`);
    process.exit(0);
  }
} catch { /* First build or incomplete assets. */ }
await mkdir(dest, { recursive: true });
async function download(url: string, file: string, digest?: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (digest && createHash("sha256").update(data).digest("hex") !== digest) throw new Error(`Asset checksum mismatch: ${url}`);
  await writeFile(file, data);
}
const archive = join(dest, "runtime.tar.gz");
try {
  console.log(`Preparing pinned native runtime ${pack.runtime.version}; no models…`);
  await download(pack.runtime.url, archive, pack.runtime.sha256);
  await exec("tar", ["-xzf", archive, "-C", dest]);
  await download(pack.template.url, join(dest, "qwen-chat-template.jinja"), pack.template.sha256);
  await download("https://raw.githubusercontent.com/ggml-org/llama.cpp/f39148a95/LICENSE", join(dest, "LLAMA-LICENSE.txt"));
  await download("https://www.apache.org/licenses/LICENSE-2.0.txt", join(dest, "MODEL-LICENSE.txt"));
  await writeFile(join(dest, "MODEL-NOTICES.txt"), "Clef-flash: Cloudflare, Apache-2.0. https://huggingface.co/Cloudflare/clef-flash\nQwen3.5-4B: Qwen, Apache-2.0. https://huggingface.co/Qwen/Qwen3.5-4B\nGGUF text weights are downloaded separately after opt-in.\n");
  // Sign nested native code before the app bundle is signed. Developer ID
  // builds inherit the same configured identity as Tauri; local builds are ad hoc.
  const engine = join(dest, `llama-${pack.runtime.version}`);
  const files = await readdir(engine, { withFileTypes: true });
  for (const file of files.filter((f) => f.isFile() && (f.name.endsWith(".dylib") || f.name.startsWith("llama-")))) {
    await exec("codesign", ["--force", "--sign", signingIdentity, ...(developerId ? ["--options", "runtime", "--timestamp"] : ["--timestamp=none"]), join(engine, file.name)]);
  }
  await writeFile(stamp, identity);
} finally { await rm(archive, { force: true }); }
