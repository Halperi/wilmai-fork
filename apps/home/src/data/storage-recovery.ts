/** Foreground-only, coalesced and bounded retries. A wake-up never bypasses native protection. */
interface RecoveryOptions {
  eligible(): boolean;
  available(): Promise<boolean>;
  recover(): Promise<void>;
  later(callback: () => void, ms: number): unknown;
  cancel(timer: unknown): void;
}
const delays = [250, 500, 1000, 2000, 5000, 10000, 30000];
export class StorageRecovery {
  private timer: unknown = null;
  private running = false;
  private queued = false;
  private disposed = false;
  private attempts = 0;
  private generation = 0;
  constructor(private options: RecoveryOptions) {}
  wake(): void {
    if (this.disposed) return;
    this.clear();
    this.attempts = 0;
    if (this.running) { this.queued = true; return; }
    void this.tick();
  }
  pause(): void { this.generation++; this.queued = false; this.clear(); }
  dispose(): void { this.disposed = true; this.pause(); }
  private clear(): void {
    if (this.timer !== null) this.options.cancel(this.timer);
    this.timer = null;
  }
  private async tick(): Promise<void> {
    if (this.disposed || !this.options.eligible() || this.attempts > delays.length) return;
    this.running = true;
    const generation = this.generation;
    this.attempts++;
    try {
      if (await this.options.available() && !this.disposed && generation === this.generation && this.options.eligible()) await this.options.recover();
    } catch { /* The store preserves dirty values and the visible error for manual retry. */ }
    finally {
      this.running = false;
      if (this.disposed) return;
      if (this.queued) { this.queued = false; this.wake(); }
      else if (generation === this.generation && this.options.eligible() && this.attempts <= delays.length) {
        this.timer = this.options.later(() => { this.timer = null; void this.tick(); }, delays[this.attempts - 1]);
      }
    }
  }
}

/** Never expose arbitrary native error text (it might include private input) in diagnostics. */
export function storageFault(error: unknown): { retryable: boolean; code: string } {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const keychain = /iOS Keychain unavailable \((-?\d+)\)/.exec(message);
  if (keychain) return { retryable: ["-25308", "-25291"].includes(keychain[1]), code: `KEYCHAIN:${keychain[1]}` };
  if (error instanceof SyntaxError || /Invalid secure storage format|Unsupported secure storage version|Invalid native installation|Invalid installation identifier|identity mismatch|Secure storage is too large/i.test(message))
    return { retryable: false, code: "STORAGE_DATA" };
  return { retryable: true, code: "STORAGE_UNAVAILABLE" };
}
