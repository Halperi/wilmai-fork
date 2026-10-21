import { WilmaAccess, logoutSession } from "./agent-data.js";
import { loadConfig, saveConfig } from "./config.js";
import { mfaCallbackFor, type ActiveAccount } from "./credentials.js";

/**
 * Wilma access for the saved (or environment) logins — the same for CLI
 * commands and the local MCP server. Refreshed child lists are written back
 * to the config, changing only that field, so parallel commands and logins
 * aren't overwritten.
 */
export function createAccess(accounts: ActiveAccount[], opts: { debug?: boolean; totpSecret?: string } = {}): WilmaAccess {
  return new WilmaAccess(
    accounts.map((account, index) => ({
      profile: { ...account.profile, debug: opts.debug ?? account.profile.debug },
      // A --totp-secret given on the command line belongs to the first (active) login.
      mfa: mfaCallbackFor(index === 0 && opts.totpSecret ? opts.totpSecret : account.totpSecret),
      label: account.stored?.tenantName ?? account.profile.baseUrl,
      knownStudents: account.stored?.students,
      onStudents: async (students) => {
        const stored = account.stored;
        // An empty answer from Wilma keeps the saved list (see knownStudents).
        if (!stored || !students.length) return;
        const fresh = students.map((s) => ({ studentNumber: s.studentNumber, name: s.name }));
        if (JSON.stringify(fresh) === JSON.stringify(stored.students ?? [])) return;
        const latest = await loadConfig();
        const target = latest.profiles.find((p) => p.id === stored.id);
        if (!target) return;
        target.students = fresh;
        await saveConfig(latest);
      },
    }))
  );
}

/**
 * End WilmAI's Wilma session for each login (see logoutSession), for `wilma
 * logout` and the wilma_logout tool. The logins stay saved. Tries every login
 * (different Wilmas don't affect each other), then throws the first failure.
 */
export async function logoutAccounts(accounts: ActiveAccount[]) {
  const results = await Promise.allSettled(accounts.map((account) => logoutSession(account.profile)));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
  const logins = accounts.map((account, index) => ({
    wilma: account.stored?.tenantName ?? account.profile.baseUrl,
    username: account.profile.username,
    session: (results[index] as PromiseFulfilledResult<boolean>).value ? ("ended" as const) : ("none" as const),
  }));
  return {
    status: "ok" as const,
    logins,
    hint: logins.length
      ? "The logins stay saved. The next time WilmAI reads Wilma it logs in again, and that ends the user's Wilma session in the browser."
      : "No saved Wilma login, so there was nothing to log out.",
  };
}
