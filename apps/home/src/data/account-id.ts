import type { AccountInfo } from "./model";

/** Stable across CLI ordering and sign-ins; never includes a password or cookie. */
export type AccountId = string & { readonly __accountId: unique symbol };

export function accountId(account: AccountInfo): AccountId {
  if (account.via === "demo") return "demo" as AccountId;
  const url = new URL(account.baseUrl);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("A Wilma account needs a plain school URL without credentials, query or fragment");
  return JSON.stringify([account.baseUrl.replace(/\/$/, "").toLowerCase(), account.username.trim().toLowerCase()]) as AccountId;
}

/** Item and child numbers are unique only within their source account. */
export interface AccountRef<T extends string | number = string | number> {
  accountId: AccountId;
  id: T;
}

export const refKey = (ref: AccountRef): string => JSON.stringify([ref.accountId, ref.id]);
