/*
 * Download helpers that work on any runtime. Fetching files from other sites
 * (bulletin links) needs network guards only Node can give (see
 * external-fetch.ts), so it's a hook the Node entry point fills in.
 */

/** How long a download may stall (before answering, or mid-file) before it fails. */
export const DOWNLOAD_TIMEOUT_MS = 60_000;

export function isHtmlResponse(response: { headers: { get(name: string): string | null } }): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.startsWith("text/html") || contentType.startsWith("application/xhtml");
}

/** Fetch a file from another site without Wilma's cookies; null when the address serves no file. */
export type ExternalFetcher = (url: string) => Promise<Response | null>;

let externalFetcher: ExternalFetcher | null = null;

export function setExternalFetcher(fetcher: ExternalFetcher | null): void {
  externalFetcher = fetcher;
}

export function getExternalFetcher(): ExternalFetcher {
  if (!externalFetcher) {
    throw new Error("Downloading files from other sites needs the Node client (@wilm-ai/wilma-client).");
  }
  return externalFetcher;
}
