/*
 * How the client talks to a Wilma: one HTTP exchange at a time, redirects not
 * followed, cookies handled by the session. Node uses undici (the default from
 * the main entry point); a browser or desktop app passes its own transport to
 * the "core" entry point, for example a native command that sends the request,
 * because web pages can't call Wilma directly (no CORS) and can't read
 * Set-Cookie headers.
 */

export interface WilmaRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface WilmaReply {
  status: number;
  /** Response headers; Set-Cookie may be missing here (browsers hide it), see setCookies. */
  headers: Headers;
  /** Every Set-Cookie header the response had, as sent. */
  setCookies: string[];
  /** The body as a stream, or a string when the transport already has it all; null when there is none. */
  body: ReadableStream<Uint8Array> | string | null;
}

/** Send one request. Must not follow redirects: the session follows them itself, hop by hop. */
export type WilmaTransport = (request: WilmaRequest) => Promise<WilmaReply>;

let defaultTransport: WilmaTransport | null = null;

/** Set the transport sessions use when none is given (the Node entry point sets undici). */
export function setDefaultTransport(transport: WilmaTransport | null): void {
  defaultTransport = transport;
}

export function getDefaultTransport(): WilmaTransport {
  if (!defaultTransport) {
    throw new Error(
      "No transport for Wilma: pass `transport` in the client options (or use @wilm-ai/wilma-client, which uses undici on Node)."
    );
  }
  return defaultTransport;
}
