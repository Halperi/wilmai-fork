/*
 * Two-step codes for a saved login that has its authenticator key (the
 * WilmAI CLI can keep one), so "Continue as" needs no typing. RFC 6238: an
 * HMAC-SHA1 of the 30-second time step, six digits. Same as the CLI's
 * (packages/wilma-cli/src/totp.ts and mfaCallbackFor), with WebCrypto.
 */
const PERIOD_MS = 30_000;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A bare base32 key, or the one in an otpauth:// address. */
function keyOf(raw: string): string {
  const value = raw.trim();
  const secret = value.startsWith("otpauth://") ? new URL(value).searchParams.get("secret") ?? "" : value;
  return secret.replace(/[\s=-]+/g, "").toUpperCase();
}

function base32Bytes(key: string): Uint8Array<ArrayBuffer> {
  let bits = "";
  for (const c of key) {
    const value = BASE32.indexOf(c);
    if (value === -1) throw new Error("The saved authenticator key isn't valid.");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return bytes;
}

export async function totpCode(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", base32Bytes(keyOf(secret)), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const message = new DataView(new ArrayBuffer(8));
  message.setUint32(0, Math.floor(counter / 0x100000000));
  message.setUint32(4, counter >>> 0);
  const hash = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = hash[hash.length - 1] & 0x0f;
  const code = ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

/**
 * wilma-client's two-step callback from a saved key. A code is used once per
 * challenge: when Wilma asks again in the same 30 seconds, it waits for the
 * next code (like the CLI).
 */
export function totpCallback(secret: string): (formkey: string) => Promise<string> {
  const usedFor = new Map<string, number>();
  return async (formkey) => {
    let counter = Math.floor(Date.now() / PERIOD_MS);
    const previous = usedFor.get(formkey);
    if (previous !== undefined && previous >= counter) {
      await new Promise((resolve) => setTimeout(resolve, (previous + 1) * PERIOD_MS - Date.now() + 50));
      counter = previous + 1;
    }
    usedFor.set(formkey, counter);
    return totpCode(secret, counter);
  };
}
