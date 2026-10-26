/*
 * Translations, automatic (Settings → Translating messages): after each check of Wilma and the AI's reading of it,
 * what came in the last 30 days that isn't in the chosen language is translated, newest first, a few at a time; an
 * older item is translated when it's opened. They're kept with the account's other data, so each is paid for once, and
 * translated again only when the item changes (a new reply, the AI's sentence on what to do) or the language does.
 */
import { buildFeed, preview, type FeedItem } from "./feed";
import { accountScope, getState, setState, useApp, type AppState } from "./store";
import { needsTranslation, sourceHash, translate, translationSource, translationTarget } from "../ai/translate";
import { LunaError, openAIReady } from "../luna/client";
import type { ItemTranslation, TranslationLanguage } from "./model";

/**
 * An item's translation into the language chosen, for lists and search (null: none). Not checked against the item's
 * text: when a reply comes, the old one shows until the new one is made.
 */
export function listedTranslation(item: FeedItem, state: Pick<AppState, "settings" | "translations">): ItemTranslation | null {
  const tr = state.translations[item.key];
  const target = translationTarget(state.settings);
  return tr && !tr.error && target && tr.language === target ? tr : null;
}

/** What a list shows for an item: its title, preview and sentence on what to do, translated when there's one. */
export function useListed(item: FeedItem): { title: string; preview: string; action: string | null } {
  const tr = useApp((s) => listedTranslation(item, s));
  if (!tr) return { title: item.title, preview: item.preview, action: item.actionLine };
  return { title: tr.title || item.title, preview: tr.texts.length ? preview(tr.texts[0]) : item.preview, action: item.actionLine ? tr.action ?? item.actionLine : null };
}

const WINDOW_DAYS = 30;
const CONCURRENCY = 3;

/** Items being translated now (the reader shows "Translating…"). */
const busy = new Set<string>();
const setBusy = (key: string, on: boolean) => {
  if (on) busy.add(key);
  else busy.delete(key);
  setState((s) => ({ translationStatus: { ...s.translationStatus, busy: [...busy] } }));
};

/** Whether an item still waits for a translation into `language` (one that failed for this text doesn't). */
function waiting(item: FeedItem, language: TranslationLanguage): boolean {
  const { snapshot, translations } = getState();
  if (!snapshot) return false;
  const source = translationSource(item, snapshot);
  if (!needsTranslation(source, language)) return false;
  const kept = translations[item.key];
  return !(kept && kept.hash === sourceHash(source) && kept.language === language);
}

/**
 * Translate one item now, unless it's translated already or being translated. A refused key, the monthly limit, no
 * connection or a busy moment at OpenAI is thrown (the next run tries again); anything else is kept as the item's
 * error, so it isn't tried again until the item changes.
 */
export async function translateItem(item: FeedItem): Promise<void> {
  const { snapshot, settings } = getState();
  const language = translationTarget(settings);
  if (!snapshot || !language || busy.has(item.key) || !waiting(item, language)) return;
  const source = translationSource(item, snapshot);
  const hash = sourceHash(source);
  const scope = accountScope();
  setBusy(item.key, true);
  try {
    // The sentence on what to do goes last, as one more text.
    const texts = source.action ? [...source.texts, source.action] : source.texts;
    const tr = await translate(source.title, texts, language);
    if (scope !== accountScope()) return;
    const action = source.action ? tr.texts.at(-1) ?? null : null;
    const body = source.action ? tr.texts.slice(0, -1) : tr.texts;
    setState((s) => ({ translations: { ...s.translations, [item.key]: { hash, language, model: tr.model, from: tr.from, title: tr.title, texts: body, action, at: Date.now() } } }));
  } catch (err) {
    if (err instanceof LunaError) throw err;
    if (scope !== accountScope()) return;
    const error = err instanceof Error ? err.message : String(err);
    setState((s) => ({ translations: { ...s.translations, [item.key]: { hash, language, model: "", from: "", title: "", texts: [], action: null, at: Date.now(), error } } }));
  } finally {
    setBusy(item.key, false);
  }
}

let running: Promise<void> | null = null;
/** Asked again while running (new items, another language): one more run after this one. */
let again = false;

/** Translate what's waiting from the last 30 days, newest first (after each reading: luna/events.ts runLuna). */
export function runTranslations(): Promise<void> {
  if (!translationTarget(getState().settings)) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    const scope = accountScope();
    const language = translationTarget(getState().settings);
    if (!language || !(await openAIReady())) return;
    const from = Date.now() - WINDOW_DAYS * 86_400_000;
    const todo = buildFeed(getState())
      .filter((i) => !i.own && i.at.getTime() >= from && waiting(i, language))
      .sort((a, b) => b.at.getTime() - a.at.getTime());
    if (!todo.length) return;
    setState((s) => ({ translationStatus: { ...s.translationStatus, running: true, done: 0, total: todo.length, error: null } }));
    let next = 0;
    let stop: string | null = null;
    const current = () => scope === accountScope() && translationTarget(getState().settings) === language;
    const worker = async () => {
      while (next < todo.length && !stop && current()) {
        try {
          await translateItem(todo[next++]);
        } catch (err) {
          stop = err instanceof Error ? err.message : String(err);
        }
        setState((s) => ({ translationStatus: { ...s.translationStatus, done: s.translationStatus.done + 1 } }));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (scope === accountScope()) setState((s) => ({ translationStatus: { ...s.translationStatus, running: false, error: stop } }));
  })().finally(() => {
    running = null;
    if (again) {
      again = false;
      void runTranslations();
    }
  });
  return running;
}
