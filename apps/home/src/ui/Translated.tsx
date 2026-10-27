/*
 * Translations on screen (data/translations.ts makes them): lists, search and Today show an item's translated title,
 * preview and sentence on what to do; the reader shows the translated text under a line saying which language it was
 * translated from, with the original a click away. An item switched to its original stays so while the app is open.
 */
import { useEffect, useState } from "react";
import { setState, useApp } from "../data/store";
import type { FeedItem } from "../data/feed";
import type { ItemTranslation, Snapshot } from "../data/model";
import { currentTranslation, needsTranslation, sourceHash, translationSource, translationTarget } from "../ai/translate";
import { translateItem } from "../data/translations";
import { Icon } from "./bits";
import { language, t } from "../i18n";

/** A language's name in the app's language ("sv": "Swedish", "ruotsi"), or the code when it has none. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([language()], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Items shown in their original while the app is open. */
const originals = new Set<string>();

export interface Translating {
  /** The translation to show (null: the original). */
  shown: ItemTranslation | null;
  /** There's a translation, shown or not: the switch shows. */
  available: ItemTranslation | null;
  busy: boolean;
  error: string | null;
  toggle: () => void;
  /** After a failure: forget it and translate again. */
  retry: () => void;
}

/** The reader's translation: translated now if it isn't yet (an item from further back, or just opened from Wilma). */
export function useTranslation(item: FeedItem, snap: Snapshot): Translating {
  const target = useApp((s) => translationTarget(s.settings));
  const stored = useApp((s) => s.translations[item.key]);
  const busy = useApp((s) => s.translationStatus.busy.includes(item.key));
  const source = translationSource(item, snap);
  const hash = sourceHash(source);
  const available = currentTranslation(stored, source, target);
  const failed = stored?.error && stored.hash === hash && stored.language === target ? stored.error : null;
  const wanted = Boolean(target && needsTranslation(source, target));
  const [original, setOriginal] = useState(() => originals.has(item.key));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOriginal(originals.has(item.key));
    setError(null);
  }, [item.key]);

  // Translate what isn't yet: the background run covers the last 30 days, and a message's text comes when it's opened.
  // The item's text (hash) and the language decide; the item object itself is rebuilt with every change.
  useEffect(() => {
    if (!wanted || available || failed) return;
    translateItem(item).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [item.key, hash, target, wanted, Boolean(available), Boolean(failed)]);

  const retry = () => {
    setError(null);
    if (stored?.error) {
      setState((s) => {
        const { [item.key]: _failed, ...rest } = s.translations;
        return { translations: rest };
      });
    }
    translateItem(item).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  const toggle = () => {
    const next = !original;
    if (next) originals.add(item.key);
    else originals.delete(item.key);
    setOriginal(next);
  };
  return { shown: available && !original ? available : null, available, busy, error: error ?? failed, toggle, retry };
}

/** The reader's switch between the translation and the original. */
export function TranslationSwitch({ tr }: { tr: Translating }) {
  if (!tr.available) return null;
  return (
    <button className={`btn btn-sm${tr.shown ? " pinned" : ""}`} aria-pressed={Boolean(tr.shown)} onClick={tr.toggle} title={tr.shown ? t("Show the original") : t("Show the translation")}>
      <Icon name="translate" />
      {tr.shown ? t("Original") : t("Translation")}
    </button>
  );
}

/** Above the text: translating, the translation's model and languages, or why it couldn't be translated. */
export function TranslationNote({ tr }: { tr: Translating }) {
  if (tr.shown) {
    return (
      <div className="translated-note">
        <Icon name="translate" />
        <span>
          {t("Translated automatically from {from}. Check times and dates against the original.", { from: languageName(tr.shown.from) })}
        </span>
        <button type="button" className="linkish" onClick={tr.toggle}>
          {t("Show original")}
        </button>
      </div>
    );
  }
  if (tr.available) return null;
  if (tr.busy) {
    return (
      <div className="translated-note">
        <Icon name="translate" />
        <span>{t("Translating…")}</span>
      </div>
    );
  }
  return tr.error ? (
    <div className="notice err translate-failed">
      <span>{t("The translation didn't work: {why}", { why: tr.error })}</span>
      <button type="button" className="btn btn-sm" onClick={tr.retry}>
        <Icon name="refresh" /> {t("Try again")}
      </button>
    </div>
  ) : null;
}
