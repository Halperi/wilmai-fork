/*
 * Before the app's code loads (import this first): a browser-ish world for
 * the app's modules in Node, and a clock each case sets to its own day.
 */
const memory = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  get length() { return memory.size; },
  key: (index: number) => [...memory.keys()][index] ?? null,
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, String(v)),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
};

/** The real clock, for timing and file names. */
export const RealDate = Date;
let fakeNow = RealDate.now();
class CaseDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(fakeNow);
    else super(...(args as [string | number | Date]));
  }
  static now() {
    return fakeNow;
  }
}
(globalThis as Record<string, unknown>).Date = CaseDate;

/** Set the app's "now" (ms). */
export const setNow = (ms: number) => {
  fakeNow = ms;
};
