/* Shared between the client and the write functions, not part of the public API. */
import type { WilmaSession } from "./session.js";

/** Each client's session, so write functions (a separate entry point) can use it. */
export const sessionOf = new WeakMap<object, WilmaSession>();
