// Real concurrent processes, synthetic files only; no Wilma or user config.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSessionLock } from "../dist/session-lock.js";
const run = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "wilmai-lock-test-"));
const path = join(directory, "wilmai-sessions.json");
const store = new URL("../dist/session-store.js", import.meta.url).href;
const env = { ...process.env, WILMAI_CONFIG_PATH: join(directory, "config.json") };
delete env.WILMAI_NO_SESSION_CACHE;
const writer = `import {fileSessionStore} from ${JSON.stringify(store)}; await fileSessionStore.save(process.argv[1], 'synthetic-cookie-'+process.argv[1]);`;
try {
  await Promise.all(Array.from({ length: 24 }, (_, i) => run(process.execPath, ["--input-type=module", "-e", writer, String(i)], { env })));
  const all = JSON.parse(await readFile(path, "utf8"));
  assert.equal(Object.keys(all).length, 24, "no account can overwrite another process's update");
  for (let i = 0; i < 24; i++) assert.equal(all[String(i)].state, `synthetic-cookie-${i}`);
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(withSessionLock(path, async () => { throw new Error("synthetic write failure"); }), /synthetic write failure/);
  await withSessionLock(path, async () => {});
  await withSessionLock(path, async () => {
    await assert.rejects(withSessionLock(path, async () => {}, 30), /locked/);
  });
  await withSessionLock(path, async () => {});
  console.log("session-lock: 24 concurrent writers, error cleanup and bounded contention passed");
} finally { await rm(directory, { recursive: true, force: true }); }
