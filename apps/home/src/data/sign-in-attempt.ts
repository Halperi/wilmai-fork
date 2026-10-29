/** A cancelled sign-in is expected control flow, never a password or network error. */
export class SignInCancelledError extends Error {
  constructor() {
    super("Sign-in cancelled");
    this.name = "SignInCancelledError";
  }
}

/** One owner for sign-in work. Each account can own one when accounts run concurrently. */
export class SignInLifecycle {
  private active: SignInAttempt | null = null;

  begin(): SignInAttempt {
    this.invalidate();
    return this.active = new SignInAttempt();
  }

  invalidate(): void {
    this.active?.cancel();
    this.active = null;
  }
}

export class SignInAttempt {
  private controller = new AbortController();
  /** After commit, this client's normal reads and logout outlive the sign-in request. */
  committed = false;

  get current(): boolean { return !this.controller.signal.aborted; }

  assertCurrent(): void {
    if (!this.current) throw new SignInCancelledError();
  }

  cancel(): void { this.controller.abort(new SignInCancelledError()); }

  /** Stop waiting promptly, while still consuming a late success or rejection from uncancellable IPC. */
  async wait<T>(work: Promise<T>): Promise<T> {
    const signal = this.controller.signal;
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new SignInCancelledError());
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
    try {
      const result = await Promise.race([work, cancelled]);
      this.assertCurrent();
      return result;
    } catch (err) {
      this.assertCurrent();
      throw err;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
}
