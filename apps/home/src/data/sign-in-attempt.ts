/*
 * One sign-in to a Wilma that may still be on its way when the parent does something else: signs out, resets the app,
 * picks the sample family, or signs that Wilma in themself. Cancelled, it can't publish anything (no session, password,
 * history entry or shared session), and its client sends nothing more to Wilma. The engine keeps one per Wilma.
 *
 * Ported from Halperi's fork (github.com/Halperi/wilmai-fork, "fix(home): cancel obsolete sign-in attempts").
 */

/** A cancelled sign-in: expected, never a password or network error, and never shown. */
export class SignInCancelledError extends Error {
  constructor() {
    super("Sign-in cancelled");
    this.name = "SignInCancelledError";
  }
}

export class SignInAttempt {
  private controller = new AbortController();
  readonly started = Date.now();
  /** Accepted: the client is the Wilma's session from now on, its reads and its logout no longer tied to this sign-in. */
  committed = false;
  /** Cancelled with a client still signed in to Wilma: only its logout goes out. */
  ending = false;
  /** The client logged in itself (and asked to save its session for the other programs): a session of its own, not one continued. */
  loggedIn = false;

  /** `by`: the parent's own sign-in, or one the app makes by itself (staying signed in, or at start). */
  constructor(readonly by: "parent" | "app") {}

  get current(): boolean {
    return !this.controller.signal.aborted;
  }

  assertCurrent(): void {
    if (!this.current) throw new SignInCancelledError();
  }

  cancel(): void {
    this.controller.abort(new SignInCancelledError());
  }

  /** Stop waiting the moment it's cancelled; what the work brings later (a late answer from Wilma) is dropped. */
  async wait<T>(work: Promise<T>): Promise<T> {
    const signal = this.controller.signal;
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new SignInCancelledError());
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
    // The work may still settle after a cancel: nobody waits for it then.
    work.catch(() => {});
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
