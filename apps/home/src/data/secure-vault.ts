/** One atomic native vault on phones; each Wilma retains its own account key. */
import { invoke } from "@tauri-apps/api/core";
import { appPlatform } from "../platform";
import type { SavedSession } from "./store";

export const usesSecureVault = appPlatform === "ios" || appPlatform === "android";
export const INSTALLATION_KEY = appPlatform === "android" ? "wilmai.androidInstallation" : "wilmai.secureInstallation";
export interface Credentials {
  jevKey: string;
  openaiKey: string;
  wilmaPassword: string;
  passwords: Record<string, string>;
}
export interface VaultData {
  version: 1;
  credentials: Credentials;
  session: SavedSession | null;
  linkedSessions: Record<string, SavedSession>;
}
export const emptyCredentials = (): Credentials => ({ jevKey: "", openaiKey: "", wilmaPassword: "", passwords: {} });
export const emptyVault = (): VaultData => ({ version: 1, credentials: emptyCredentials(), session: null, linkedSessions: {} });
interface Bridge {
  load(installation: string): Promise<string | null>;
  save(installation: string, data: string): Promise<void>;
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const session = (v: unknown): v is SavedSession => object(v) && typeof v.state === "string" && object(v.account)
  && typeof v.account.baseUrl === "string" && typeof v.account.username === "string";
function parseVault(raw: string): VaultData {
  const v: unknown = JSON.parse(raw);
  if (!object(v) || v.version !== 1 || !object(v.credentials)) throw new Error("Invalid secure storage format");
  const credentials = v.credentials;
  if (!object(credentials.passwords)
    || !["jevKey", "openaiKey", "wilmaPassword"].every((k) => typeof credentials[k] === "string")
    || !Object.values(credentials.passwords).every((p) => typeof p === "string")
    || !(v.session === null || session(v.session)) || !object(v.linkedSessions)
    || !Object.values(v.linkedSessions).every(session)) throw new Error("Invalid secure storage format");
  return v as unknown as VaultData;
}

/** Desired values remain dirty on failure, so retry cannot revive an old password or logged-out session. */
export class SecureVault {
  private installation: string | null = null;
  private loaded = false;
  private value: VaultData | null = null;
  private revision = 0;
  private storedRevision = 0;
  private pending: Promise<void> | null = null;
  constructor(private bridge: Bridge) {}
  async load(installation: string): Promise<void> {
    if (this.loaded) return;
    const raw = await this.bridge.load(installation);
    const value = raw === null ? null : parseVault(raw);
    this.installation = installation;
    this.value = value;
    this.loaded = true;
  }
  get data(): VaultData | null { return this.value === null ? null : structuredClone(this.value); }
  update(change: (data: VaultData) => VaultData): void {
    if (!this.loaded) throw new Error("Secure storage has not been opened");
    this.value = structuredClone(change(this.value === null ? emptyVault() : structuredClone(this.value)));
    this.revision += 1;
  }
  flush(): Promise<void> {
    if (!this.loaded || !this.installation) return Promise.reject(new Error("Secure storage has not been opened"));
    if (this.pending) return this.pending.then(() => this.flush());
    if (this.storedRevision === this.revision) return Promise.resolve();
    this.pending = (async () => {
      while (this.storedRevision !== this.revision) {
        const revision = this.revision;
        const data = JSON.stringify(this.value);
        await this.bridge.save(this.installation!, data);
        this.storedRevision = revision;
      }
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
}
export const secureVault = new SecureVault({
  load: (installation) => invoke<string | null>(appPlatform === "android" ? "plugin:android-device|vault_load" : "ios_vault_load", { installation }),
  save: (installation, data) => invoke<void>(appPlatform === "android" ? "plugin:android-device|vault_save" : "ios_vault_save", { installation, data }),
});

/** A new app installation must not recover credentials left in Keychain after uninstall. */
export function secureInstallation(): string {
  let id = localStorage.getItem(INSTALLATION_KEY);
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) {
    // getRandomValues also works on WKWebView's custom app scheme; randomUUID requires a secure context.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    localStorage.setItem(INSTALLATION_KEY, id);
  }
  return id;
}
