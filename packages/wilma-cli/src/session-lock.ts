import { mkdir, rmdir } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout } from "node:timers/promises";

/** Shared with Home's session_lock.rs. The entire read/modify/rename must hold this directory. */
export async function withSessionLock<T>(path: string, task: () => Promise<T>, timeoutMs = 5000): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = `${path}.lock`;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error("The shared Wilma session store is locked. Close all WilmAI programs before removing its wilmai-sessions.json.lock directory after an interrupted write.");
      await setTimeout(20);
    }
  }
  try { return await task(); }
  finally { await rmdir(lock); }
}
