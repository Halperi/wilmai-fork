// Requires a Rust compiler and a built wilma-cli. Synthetic local files only.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const run = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "wilmai-cross-lock-"));
const counter = join(directory, "counter");
const source = join(directory, "driver.rs");
const binary = join(directory, process.platform === "win32" ? "driver.exe" : "driver");
const rustModule = fileURLToPath(new URL("../src-tauri/src/session_lock.rs", import.meta.url));
const nodeModule = new URL("../../../packages/wilma-cli/dist/session-lock.js", import.meta.url).href;
const driver = `#[path = ${JSON.stringify(rustModule)}] mod session_lock;
fn main() {
 let path = std::path::PathBuf::from(std::env::args().nth(1).unwrap());
 for _ in 0..20 {
  let _lock = session_lock::SessionLock::acquire(&path).unwrap();
  let n: u32 = std::fs::read_to_string(&path).unwrap().parse().unwrap();
  std::thread::sleep(std::time::Duration::from_millis(2));
  std::fs::write(&path, (n+1).to_string()).unwrap();
 }
}`;
const nodeDriver = `import {withSessionLock} from ${JSON.stringify(nodeModule)};
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout} from 'node:timers/promises';
const path=process.argv[1];
for(let i=0;i<20;i++) await withSessionLock(path,async()=>{const n=Number(await readFile(path,'utf8'));await setTimeout(2);await writeFile(path,String(n+1));});`;
try {
  await writeFile(source, driver);
  await writeFile(counter, "0", { mode: 0o600 });
  await run(process.env.RUSTC || "rustc", ["--edition=2021", source, "-o", binary]);
  await Promise.all(Array.from({ length: 4 }, () => [
    run(binary, [counter]),
    run(process.execPath, ["--input-type=module", "-e", nodeDriver, counter]),
  ]).flat());
  assert.equal(await readFile(counter, "utf8"), "160");
  console.log("cross-language session lock: 4 Rust + 4 Node processes, all 160 updates retained");
} finally { await rm(directory, { recursive: true, force: true }); }
