import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { getState, useApp } from "../data/store";
import type { Viewer } from "../data/model";
import { useLocalEdition } from "../data/edition";
import { UpdatesCard } from "./Update";
import { go } from "./shared";
import { SignInAgainError, cliAccounts, signInDemo, signInWithCli, signInWithPassword, type CliAccount } from "../data/engine";
import { Brand, Icon } from "./bits";
import { TENANTS, searchTenants, type Tenant } from "../data/tenants";
import { isDesktopApp } from "../wilma/transport";
import { t } from "../i18n";
import { SignInCancelledError } from "../data/sign-in-attempt";

/** A sentence translated whole, with the part between asterisks wrapped in markup: "School, *sorted*." */
function marked(text: string, wrap: (part: string) => ReactNode): ReactNode {
  const [before, part, after = ""] = text.split("*");
  return part === undefined ? text : (
    <>
      {before}
      {wrap(part)}
      {after}
    </>
  );
}

export function SignIn() {
  const localEdition = useLocalEdition();
  const reason = useApp((s) => s.signedOutReason);
  // Signed out by Wilma, or started again: the login the app knows, and its password when it's remembered.
  const known = useApp((s) => (s.snapshot?.account.via === "password" ? s.snapshot.account : null));
  const remembered = useApp((s) => s.settings.wilmaPassword);
  const [remember, setRemember] = useState(() => getState().settings.rememberPassword !== false);
  const [cli, setCli] = useState<CliAccount[]>([]);
  const [query, setQuery] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(() => {
    const saved = known?.baseUrl ?? localStorage.getItem("wilmai.tenant");
    return saved ? (TENANTS.find((t) => t.url.replace(/\/$/, "") === saved.replace(/\/$/, "")) ?? null) : null;
  });
  const [username, setUsername] = useState(known?.username ?? "");
  const [password, setPassword] = useState("");
  // Who signs in: chosen here. Until it's touched, a school address ("…@edu.city.fi") suggests a student, anything else a guardian.
  const [role, setRole] = useState<Viewer | null>(null);
  const who: Viewer = role ?? (/@(?:[^@.]+\.)*edu(?:\.|$)/i.test(username.trim()) ? "student" : "guardian");
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState<((code: string) => Promise<void>) | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const matches = useMemo(() => searchTenants(query), [query]);

  useEffect(() => {
    void cliAccounts().then(setCli);
  }, []);

  const run = async (label: string, task: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await task();
    } catch (err) {
      if (!(err instanceof SignInCancelledError)) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  /** One click: the CLI's saved login (a code is asked here only when Wilma wants one the login can't make). */
  const continueAs = (a: CliAccount) =>
    void run(`cli:${a.index}`, async () => {
      const next = await signInWithCli(a);
      if (!next) return;
      setTenant(TENANTS.find((x) => x.url.replace(/\/$/, "") === a.baseUrl) ?? { url: a.baseUrl, name: a.tenantName ?? new URL(a.baseUrl).host, municipalities: [] });
      setMfa(() => next.mfa);
    });

  const pick = (t: Tenant) => {
    setTenant(t);
    setQuery("");
    localStorage.setItem("wilmai.tenant", t.url);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    if (mfa) {
      void run("code", () =>
        mfa(code).catch((err) => {
          if (err instanceof SignInAgainError) setMfa(null);
          throw err;
        })
      );
      return;
    }
    void run("password", async () => {
      const next = await signInWithPassword(tenant.url, username.trim(), password, undefined, false, who, remember);
      setPassword("");
      if (next) setMfa(() => next.mfa);
    });
  };

  /** One click: the known login with the remembered password. A refused one is forgotten (it was changed in Wilma). */
  const signInAgain = () =>
    void run("again", async () => {
      if (!known) return;
      const next = await signInWithPassword(known.baseUrl, known.username, remembered);
      if (next) setMfa(() => next.mfa);
    });

  const host = tenant ? new URL(tenant.url).host : null;

  return (
    <div className="signin">
      <section className="signin-side">
        <Brand style={{ padding: 0 }} />
        <h1>{marked(t("School, *sorted*."), (part) => <span className="mark on">{part}</span>)}</h1>
        <p className="lede">
          {t("Today's lessons, the messages that need you, and what's coming up, for a student or the whole family.")}{" "}
          {isDesktopApp ? t("It reads the same Wilma you already use, and it runs on this computer.") : t("It reads the same Wilma you already use, and it runs in this browser.")}
        </p>
        <ul className="facts" style={{ maxWidth: 520 }}>
          <li>
            <Icon name="device" />
            <span>
              <b>{isDesktopApp ? t("Stays on this computer.") : t("Stays in this browser.")}</b> {t("No WilmAI server stores or passes on anything.")}
            </span>
          </li>
          <li>
            <Icon name="lock" />
            <span>
              {marked(t("*Your password goes only to your school's Wilma.* The app remembers it here, scrambled, so signing in again is one click."), (part) => <b>{part}</b>)}
            </span>
          </li>
          <li>
            <Icon name="spark" />
            <span>
              <b>{t("WilmAI Intelligence is optional.")}</b> {localEdition === true ? t("Once you're in, choose it in Settings: OpenAI with your own key, usually tens of cents a month, or local AI on this Mac.") : t("Once you're in, choose it in Settings. OpenAI with your own key usually costs tens of cents a month.")}
            </span>
          </li>
        </ul>
      </section>

      <section className="signin-panel" aria-labelledby="signin-h">
        {isDesktopApp ? <UpdatesCard compact /> : null}
        <h2 id="signin-h">{t("Sign in with Wilma")}</h2>
        {reason ? <div className="notice err">{reason}</div> : null}

        {known && remembered && tenant && !mfa ? (
          <div className="alt">
            <button className="btn btn-primary continue-as" disabled={Boolean(busy)} onClick={signInAgain}>
              <Icon name="lock" />
              <span>
                {busy === "again" ? t("Signing in…") : t("Sign in as {name}", { name: known.username })}
                <small>{known.tenantName ?? tenant.name}</small>
              </span>
            </button>
            <small>{t("With the password remembered on this computer.")}</small>
            <div className="or">{t("or sign in another way")}</div>
          </div>
        ) : null}

        {cli.length && !mfa ? (
          <div className="alt">
            {cli.map((a) => (
              <button key={a.index} className="btn btn-primary continue-as" disabled={Boolean(busy)} onClick={() => continueAs(a)}>
                <Icon name="device" />
                <span>
                  {busy === `cli:${a.index}` ? t("Opening Wilma…") : t("Continue as {name}", { name: a.username })}
                  {cli.length > 1 || a.tenantName ? <small>{a.tenantName ?? new URL(a.baseUrl).host}</small> : null}
                </span>
              </button>
            ))}
            <small>{t("Uses the login the WilmAI CLI saved on this computer. A session another WilmAI program has open is continued, so nothing else gets signed out.")}</small>
            <div className="or">{t("or sign in yourself")}</div>
          </div>
        ) : null}

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {tenant ? (
            <div className="picked">
              <Icon name="book" />
              <div>
                <b>{tenant.name}</b>
                <small>{host}</small>
              </div>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setTenant(null)} disabled={Boolean(mfa)}>
                {t("Change")}
              </button>
            </div>
          ) : (
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="school">{t("Your school's Wilma")}</label>
              <input id="school" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Town or school, e.g. Tampere")} autoComplete="off" autoFocus />
              {matches.length ? (
                <div className="schools" role="listbox" aria-label={t("Matching Wilmas")}>
                  {matches.map((t) => (
                    <button type="button" key={t.url} role="option" aria-selected={false} onClick={() => pick(t)}>
                      {t.name}
                      <small>
                        {new URL(t.url).host}
                        {t.municipalities.length ? ` · ${t.municipalities.map((m) => m.name_fi).join(", ")}` : ""}
                      </small>
                    </button>
                  ))}
                </div>
              ) : query.trim().length >= 2 ? (
                <span className="help">{t("No Wilma matches “{query}”.", { query })}</span>
              ) : null}
            </div>
          )}

          {tenant && !mfa ? (
            <>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="user">{t("Username")}</label>
                <input id="user" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="pass">{t("Password")}</label>
                <input id="pass" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                <span className="help">{t("Sent only to {host}.", { host: host ?? "" })}</span>
              </div>
              <label className="remember">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>
                  {t("Remember on this computer")}
                  <small>{t("Signing in again is then one click. Kept scrambled, not encrypted: leave this off on a shared computer.")}</small>
                </span>
              </label>
              <div className="field" style={{ marginBottom: 0 }}>
                <span className="label" id="who-label">{t("Who uses this account")}</span>
                <div role="group" aria-labelledby="who-label" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(["guardian", "student"] as const).map((v) => (
                    <button type="button" key={v} className="seg" aria-pressed={who === v} onClick={() => setRole(v)}>
                      {v === "guardian" ? t("A parent") : t("A student")}
                    </button>
                  ))}
                </div>
                <span className="help">
                  {who === "student"
                    ? t("A student sees their own tasks, exams and homework first.")
                    : t("A parent sees what parents need to do first: replies, sign-ups and absences.")}
                </span>
              </div>
            </>
          ) : null}

          {mfa ? (
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="code">{t("Code from your authenticator app")}</label>
              <input id="code" className="input" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus required />
            </div>
          ) : null}

          {error ? <div className="notice err">{error}</div> : null}

          {tenant ? (
            <button className="btn btn-primary" type="submit" disabled={Boolean(busy)} style={{ justifyContent: "center" }}>
              {busy === "password" || busy === "code" ? t("Signing in…") : mfa ? t("Check the code") : t("Sign in")}
            </button>
          ) : null}
        </form>

        <div className="or">{t("or")}</div>
        <button className="btn" onClick={() => { go("today"); void signInDemo(); }} style={{ justifyContent: "center" }}>
          {t("Look around with a sample family")}
        </button>
      </section>
    </div>
  );
}
