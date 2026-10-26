/*
 * The app's own words in Finnish, Swedish or English. Wilma's content (messages,
 * bulletins, Wilma's labels such as "Omat opettajat") stays as Wilma wrote it,
 * unless it's translated (Settings → Translating messages; data/translations.ts).
 *
 *   t("Report {name} absent", { name })      → a string
 *   tx("Send it to {to}?", { to: <b>…</b> })  → for JSX, when a part is markup
 *
 * The English text is the key; Finnish and Swedish come from the dictionaries
 * below (one per screen, merged; the Swedish made from the Finnish, key for key,
 * by scripts/translate-ui.ts). A missing entry falls back to English and is
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
import { SV_COMMON } from "./sv-common";
import { SV_TODAY } from "./sv-today";
import { SV_INBOX } from "./sv-inbox";
import { SV_FORMS } from "./sv-forms";
import { SV_DATA } from "./sv-data";
import { SV_PALETTE } from "./sv-palette";
import { SV_UPDATES } from "./sv-updates";

export type Lang = "en" | "fi" | "sv";
const FI: Record<string, string> = { ...FI_COMMON, ...FI_TODAY, ...FI_INBOX, ...FI_FORMS, ...FI_DATA, ...FI_PALETTE, ...FI_UPDATES };
/** Swedish: made from the Finnish dictionaries, key for key (scripts/translate-ui.ts). */
const SV: Record<string, string> = { ...SV_COMMON, ...SV_TODAY, ...SV_INBOX, ...SV_FORMS, ...SV_DATA, ...SV_PALETTE, ...SV_UPDATES };
const DICTIONARIES: Record<Exclude<Lang, "en">, Record<string, string>> = { fi: FI, sv: SV };

let current: Lang = "en";

/** The language for a setting: "auto" follows the computer's language. */
export function resolveLanguage(setting: "auto" | Lang): Lang {
  if (setting !== "auto") return setting;
  const preferred = typeof navigator === "undefined" ? [] : [...(navigator.languages ?? []), navigator.language];
  for (const l of preferred) {
    if (/^fi\b/i.test(l ?? "")) return "fi";
    if (/^sv\b/i.test(l ?? "")) return "sv";
  }
  return "en";
}

export function setLanguage(lang: Lang): void {
  if (lang === current && document.documentElement.lang === lang) return;
  current = lang;
  setDateLanguage(lang);
  document.documentElement.lang = lang;
}

export const language = (): Lang => current;

/** For Intl's numbers and dates: Finland's Finnish and Swedish, British English. */
export const locale = (): string => ({ en: "en-GB", fi: "fi-FI", sv: "sv-FI" })[current];

const missing = new Set<string>();

function lookup(en: string): string {
  if (current === "en") return en;
  const text = DICTIONARIES[current][en];
  if (text !== undefined) return text;
  if (import.meta.env.DEV && !missing.has(`${current}:${en}`)) {
    missing.add(`${current}:${en}`);
    console.warn(`[i18n] no ${current === "fi" ? "Finnish" : "Swedish"} for: ${en}`);
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
