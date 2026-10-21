/*
 * The app's own words in Finnish or English. Wilma's content (messages,
 * bulletins, Wilma's labels such as "Omat opettajat") stays as Wilma wrote it.
 *
 *   t("Report {name} absent", { name })      → a string
 *   tx("Send it to {to}?", { to: <b>…</b> })  → for JSX, when a part is markup
 *
 * The English text is the key; Finnish comes from the dictionaries below
 * (one per screen, merged). Missing Finnish falls back to English and is
 * listed once in the console while developing.
 */
import { Fragment, createElement, type ReactNode } from "react";
import { setDateLanguage } from "../data/dates";
import { FI_COMMON } from "./fi-common";
import { FI_TODAY } from "./fi-today";
import { FI_INBOX } from "./fi-inbox";
import { FI_FORMS } from "./fi-forms";
import { FI_DATA } from "./fi-data";
import { FI_PALETTE } from "./fi-palette";
import { FI_UPDATES } from "./fi-updates";

export type Lang = "en" | "fi";
const FI: Record<string, string> = { ...FI_COMMON, ...FI_TODAY, ...FI_INBOX, ...FI_FORMS, ...FI_DATA, ...FI_PALETTE, ...FI_UPDATES };

let current: Lang = "en";

/** The language for a setting: "auto" follows the computer's language. */
export function resolveLanguage(setting: "auto" | Lang): Lang {
  if (setting !== "auto") return setting;
  const preferred = typeof navigator === "undefined" ? [] : [...(navigator.languages ?? []), navigator.language];
  return preferred.some((l) => /^fi\b/i.test(l ?? "")) ? "fi" : "en";
}

export function setLanguage(lang: Lang): void {
  if (lang === current && document.documentElement.lang === lang) return;
  current = lang;
  setDateLanguage(lang);
  document.documentElement.lang = lang;
}

export const language = (): Lang => current;

const missing = new Set<string>();

function lookup(en: string): string {
  if (current === "en") return en;
  const fi = FI[en];
  if (fi !== undefined) return fi;
  if (import.meta.env.DEV && !missing.has(en)) {
    missing.add(en);
    console.warn(`[i18n] no Finnish for: ${en}`);
  }
  return en;
}

/** The text in the app's language, with {placeholders} filled in. */
export function t(en: string, vars?: Record<string, string | number>): string {
  const text = lookup(en);
  return vars ? text.replace(/\{(\w+)\}/g, (_, key: string) => (key in vars ? String(vars[key]) : `{${key}}`)) : text;
}

/** Like t(), for JSX: placeholders may be markup (<b>…</b>, links). */
export function tx(en: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = lookup(en).split(/(\{\w+\})/g);
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) => {
      const key = /^\{(\w+)\}$/.exec(part)?.[1];
      return key && key in vars ? createElement(Fragment, { key: i }, vars[key]) : part;
    })
  );
}

/** "1 item" / "3 items": English plural by count (Finnish entries give both forms). */
export function plural(count: number, one: string, many: string): string {
  return t(count === 1 ? one : many, { n: count });
}
