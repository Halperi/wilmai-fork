/*
 * Idle timeouts for requests and downloads. A request fails when the server
 * stops answering for a while — before the response, or while the body is
 * read — not after a fixed total, so a large attachment on a slow connection
 * still finishes while a stalled one doesn't hang forever.
 */
import { NetworkError, wrapNetworkError } from "./network-error.js";

/** An abort signal that fires after `ms` without progress. */
export class IdleTimer {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly ms: number) {
    this.touch();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Progress: start the wait over. */
  touch(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => this.controller.abort(new DOMException("The server stopped answering", "TimeoutError")),
      this.ms
    );
    // A response nobody reads must not keep the process alive (Node only).
    (this.timer as { unref?: () => void } | undefined)?.unref?.();
  }

  stop(): void {
    clearTimeout(this.timer);
  }
}

/** A timeout or broken connection as a NetworkError; anything else unchanged. */
export function asNetworkError(err: unknown, origin: string): unknown {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return new NetworkError(`${origin} didn't answer in time`, { code: "TIMEOUT", origin, cause: err });
  }
  return wrapNetworkError(err, origin);
}

// Statuses whose responses can't carry a body.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * The same response, with its body read under the idle timer: each chunk
 * restarts the wait, and a stall or broken connection while reading surfaces
 * as a NetworkError, like one before the response.
 */
export function watchBody(
  response: { status: number; statusText?: string; headers: unknown; body: unknown; url: string },
  idle: IdleTimer,
  origin: string
): Response {
  return watchedResponse(
    {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers as Headers,
      body: response.body as ReadableStream<Uint8Array> | null,
      url: response.url,
    },
    idle,
    origin
  );
}

export interface ResponseParts {
  status: number;
  statusText?: string;
  headers: Headers;
  body: ReadableStream<Uint8Array> | string | null;
  /** The address that answered: parsers resolve links against it. */
  url: string;
}

/** A standard Response from a transport's reply, its body read under the idle timer. */
export function watchedResponse(parts: ResponseParts, idle: IdleTimer, origin: string): Response {
  const make = (body: ReadableStream<Uint8Array> | string | null) => {
    const response = new Response(body as never, { status: parts.status, statusText: parts.statusText, headers: parts.headers });
    Object.defineProperty(response, "url", { value: parts.url });
    return response;
  };
  if (parts.body === null || typeof parts.body === "string" || NULL_BODY_STATUSES.has(parts.status)) {
    idle.stop();
    if (parts.body && typeof parts.body !== "string") void parts.body.cancel().catch(() => {});
    return make(NULL_BODY_STATUSES.has(parts.status) ? null : parts.body);
  }
  const reader = parts.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          idle.stop();
          controller.close();
          return;
        }
        idle.touch();
        controller.enqueue(value);
      } catch (err) {
        idle.stop();
        controller.error(asNetworkError(err, origin));
      }
    },
    cancel(reason) {
      idle.stop();
      return reader.cancel(reason);
    },
  });
  return make(body);
}
