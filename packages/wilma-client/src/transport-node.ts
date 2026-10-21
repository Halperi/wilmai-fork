/* The Node transport: undici's fetch, redirects not followed. */
import { fetch } from "undici";
import type { WilmaTransport } from "./transport.js";

export const nodeTransport: WilmaTransport = async (request) => {
  const resp = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    redirect: "manual",
  });
  const headers = resp.headers as unknown as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() ?? [resp.headers.get("set-cookie")].filter((c): c is string => Boolean(c));
  return {
    status: resp.status,
    headers,
    setCookies,
    body: resp.body as unknown as ReadableStream<Uint8Array> | null,
  };
};
