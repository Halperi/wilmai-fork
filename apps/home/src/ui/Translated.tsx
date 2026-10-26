/*
 * The reader's Translate button (ai/translate.ts). The translation takes the text's place, under a line saying it's a
 * translation, by which AI and from which language, with the original a click away. A translation made before shows
 * again when the item opens; an item switched back to its original stays so while the app is open.
 */
import { useEffect, useRef, useState } from "react";
import { useApp } from "../data/store";
import { guessLanguage, keptTranslation, translate, translationTarget, type Translation } from "../ai/translate";
import { READING_MODELS } from "../luna/client";
import { Icon } from "./bits";
import { language, t } from "../i18n";

/** Items switched back to the original, while the app is open. */
const original = new Set<string>();

/** A language's name in the app's language ("sv": "Swedish", "ruotsi"), or the code when it has none. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([language()], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export interface Translating {
  /** The button shows: AI and translation are on, and the text isn't already in that language. */
  offered: boolean;
  target: string | null;
  shown: Translation | null;
  busy: boolean;
  error: string | null;
  toggle: () => void;
}

export function useTranslation(itemKey: string, title: string, texts: string[]): Translating {
  const settings = useApp((s) => s.settings);
  const target = translationTarget(settings);
  const offered = Boolean(target && texts.some((x) => x.trim()) && guessLanguage(texts.join("\n")) !== target);
  const [shown, setShown] = useState<Translation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What's open now: an answer for an item no longer open is dropped.
  const textKey = JSON.stringify([itemKey, target, title, texts]);
  const open = useRef(textKey);
  open.current = textKey;

  useEffect(() => {
    setShown(null);
    setError(null);
    setBusy(false);
    if (!offered || !target || original.has(itemKey)) return;
    void keptTranslation(title, texts, target).then((kept) => {
      if (kept && open.current === textKey) setShown(kept);
    });
  }, [textKey, offered]); // textKey holds the item, the language and the text

  const toggle = () => {
    if (!target || busy) return;
    if (shown) {
      original.add(itemKey);
      setShown(null);
      return;
    }
    original.delete(itemKey);
    setBusy(true);
    setError(null);
    const asked = textKey;
    translate(title, texts, target).then(
      (translation) => {
        if (open.current !== asked) return;
        setShown(translation);
        setBusy(false);
      },
      (err: unknown) => {
        if (open.current !== asked) return;
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      }
    );
  };

  return { offered, target, shown, busy, error, toggle };
}

/** The Translate button, for the reader's top bar. */
export function TranslateButton({ tr }: { tr: Translating }) {
  if (!tr.offered && !tr.shown) return null;
  return (
    <button
      className={`btn btn-sm${tr.shown ? " pinned" : ""}`}
      aria-pressed={Boolean(tr.shown)}
      onClick={tr.toggle}
      disabled={tr.busy}
      title={tr.shown ? t("Show the original") : t("Translate into {language} with AI", { language: languageName(tr.target ?? "") })}
    >
      <Icon name="translate" />
      {tr.busy ? t("Translating…") : tr.shown ? t("Original") : t("Translate")}
    </button>
  );
}

/** Above a translated text: by whom, from and to which language, and the way back to the original. */
export function TranslationNote({ tr }: { tr: Translating }) {
  if (tr.error) return <div className="notice err">{t("The translation didn't work: {why}", { why: tr.error })}</div>;
  if (!tr.shown) return null;
  const by = READING_MODELS[tr.shown.model]?.label ?? tr.shown.model;
  return (
    <div className="translated-note">
      <Icon name="translate" />
      <span>
        {t("Translated by {by}, {from} → {to}. Check times and dates against the original.", {
          by,
          from: languageName(tr.shown.from),
          to: languageName(tr.shown.language),
        })}
      </span>
      <button type="button" className="linkish" onClick={tr.toggle}>
        {t("Show original")}
      </button>
    </div>
  );
}
