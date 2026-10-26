/*
 * Translating a message, bulletin or teacher's note into the language chosen in Settings, with OpenAI and the parent's
 * key: GPT-6 Luna or GPT-6.1 Sol as chosen, each at its least reasoning (which bills as output). Not with local AI: its
 * small model translates the languages offered poorly. Only when asked (the Translate button). Each translation is kept on this computer by
 * its text, language and model, so it's paid for once; a reset forgets them with everything else.
 */
import { get, set } from "idb-keyval";
import { intelligenceOn, intelligenceProvider, type Settings, type TranslationLanguage } from "../data/model";
import { getState, resetScope } from "../data/store";
import { hash } from "../data/hash";
import { resolveLanguage } from "../i18n";
import { respond } from "../luna/client";

/** The languages offered, each named in itself. */
export const TRANSLATION_LANGUAGES: Record<TranslationLanguage, string> = { fi: "Suomi", sv: "Svenska", en: "English", uk: "Українська", ar: "العربية" };
const IN_ENGLISH: Record<TranslationLanguage, string> = { fi: "Finnish", sv: "Swedish", en: "English", uk: "Ukrainian", ar: "Arabic" };

/**
 * The two OpenAI translators offered, with what a message's translation costs at OpenAI's list prices, rounded up
 * (evals/translate.ts, 26 Oct 2026: made-up messages, bulletins and threads, Finnish and Swedish into the other four;
 * Sol $0.0024 on average and $0.0039 at most, all 180 checks; Luna $0.0001 and $0.0002, and a Swedish bulletin came
 * back untranslated into Finnish). Sol is the default: Luna's slip is caught (below), but Sol doesn't need catching.
 */
export const TRANSLATORS = [
  { model: "gpt-6.1-sol", label: "Most accurate", help: "Careful with long and tricky messages.", perMessage: 0.003 },
  { model: "gpt-6-luna", label: "Fast", help: "Good for everyday messages. If it can't translate one, Most accurate does.", perMessage: 0.0001 },
] as const;
export type Translator = (typeof TRANSLATORS)[number]["model"];
export const DEFAULT_TRANSLATOR: Translator = "gpt-6.1-sol";
/** The least reasoning a model takes: Sol's least is low (26 Oct 2026), Luna's none. */
const leastEffort = (model: string) => (model === "gpt-6-luna" ? "none" : "low") as "none" | "low";

/** What the Translate button translates into: null when translation is off, or OpenAI isn't the AI. */
export function translationTarget(s: Settings): TranslationLanguage | null {
  if (!translationAvailable(s) || s.translateTo === "off") return null;
  return s.translateTo ?? resolveLanguage(s.language);
}

/** Translation comes with OpenAI. */
export const translationAvailable = (s: Settings) => intelligenceProvider(s) === "openai" && intelligenceOn(s);
const translationModel = (s: Settings): string => s.translateModel ?? DEFAULT_TRANSLATOR;

/*
 * The language a text is most likely in, from its letters and its most common words: enough to leave the button off a
 * message that's already in the parent's language. null when it can't tell (the button shows then).
 */
const COMMON: Partial<Record<TranslationLanguage, string[]>> = {
  fi: ["ja", "on", "ei", "että", "klo", "hei", "kiitos", "tai", "myös", "ovat", "voi", "kun", "olla", "koulu", "huomenna", "tänään", "oppilaat", "terveisin"],
  sv: ["och", "att", "det", "är", "på", "för", "med", "som", "inte", "hej", "vi", "till", "av", "har", "kan", "skolan", "eleverna", "tack", "hälsningar"],
  en: ["the", "and", "is", "to", "of", "for", "with", "you", "are", "we", "please", "thank", "school", "will", "your", "this"],
};

export function guessLanguage(text: string): TranslationLanguage | "other" | null {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 12) return null;
  const share = (re: RegExp) => letters.filter((c) => re.test(c)).length / letters.length;
  if (share(/\p{Script=Arabic}/u) > 0.3) return "ar";
  if (share(/\p{Script=Cyrillic}/u) > 0.3) return /[іїєґ]/iu.test(text) ? "uk" : "other";
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const scores = (Object.entries(COMMON) as [TranslationLanguage, string[]][])
    .map(([lang, common]) => [lang, words.filter((w) => common.includes(w)).length] as const)
    .sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  return best[1] >= 3 && best[1] >= 2 * second[1] ? best[0] : null;
}

export interface Translation {
  language: TranslationLanguage;
  model: string;
  /** The language it was translated from, as the AI named it: an ISO 639-1 code ("sv"). */
  from: string;
  title: string;
  /** One per text asked, in order: a thread's messages, or the one text. */
  texts: string[];
  at: number;
}

/* Kept translations, newest last, at most a few hundred (a message's is a few kilobytes). */
const STORE = "translations";
const KEEP = 400;
let kept: { generation: number; byKey: Record<string, Translation> } | null = null;

async function keptTranslations(): Promise<Record<string, Translation>> {
  if (kept?.generation !== resetScope()) {
    const generation = resetScope();
    // Without IndexedDB (the eval suite), idb-keyval throws at once rather than rejecting: nothing is kept then.
    const byKey = (await (async () => get<Record<string, Translation>>(STORE))().catch(() => undefined)) ?? {};
    kept = { generation, byKey };
  }
  return kept.byKey;
}

function keep(key: string, translation: Translation) {
  if (!kept) return;
  const entries = Object.entries({ ...kept.byKey, [key]: translation }).sort((a, b) => a[1].at - b[1].at).slice(-KEEP);
  kept.byKey = Object.fromEntries(entries);
  const byKey = kept.byKey;
  void (async () => set(STORE, byKey))().catch(() => {}); // No IndexedDB in pure eval runs.
}

const keyOf = (model: string, language: TranslationLanguage, title: string, texts: string[]) => `${language}:${model}:${hash([title, texts])}`;

/** A translation already made for this text, language and the AI now chosen (none: null). */
export async function keptTranslation(title: string, texts: string[], language: TranslationLanguage): Promise<Translation | null> {
  return (await keptTranslations())[keyOf(translationModel(getState().settings), language, title, texts)] ?? null;
}

const instructions = (language: TranslationLanguage) =>
  [
    `You translate what a Finnish school sent through Wilma (a message, a bulletin or a teacher's note) into ${IN_ENGLISH[language]}, for a parent or a pupil.`,
    `The input is JSON: a title and texts. Translate the title, and each text in order, into one translation per text, so there are as many translations as texts.`,
    `Keep the meaning, the tone and every detail. Add nothing, explain nothing and leave nothing out.`,
    `Keep the line breaks, paragraphs, lists and links as they are.`,
    `Keep people's names, signatures, class and group names (7G, 3B), course codes, numbers, times, amounts and addresses exactly as written.`,
    `Translate weekday and month names, and keep dates' numbers as written (pe 30.10. becomes the weekday in ${IN_ENGLISH[language]} and 30.10.).`,
    `When the text names something the reader may need to find in Wilma or at school, such as a form, a page or a course, give the original word in brackets after its translation, the first time only.`,
    `In "from", give the ISO 639-1 code of the language the texts are written in (fi, sv, en…).`,
  ].join("\n");

const ALPHABET: Partial<Record<TranslationLanguage, RegExp>> = { uk: /\p{Script=Cyrillic}/gu, ar: /\p{Script=Arabic}/gu };

/**
 * The answer is still the original: every text unchanged, or into Ukrainian or Arabic mostly not in that alphabet
 * (names, codes and links stay in theirs), or still in the original language when that can be told.
 */
function untranslated(texts: string[], answer: string[], language: TranslationLanguage): boolean {
  if (answer.every((text, i) => text.trim() === texts[i]?.trim())) return true;
  const all = answer.join("\n");
  const alphabet = ALPHABET[language];
  if (alphabet) return (all.match(alphabet) ?? []).length <= (all.match(/\p{L}/gu) ?? []).length / 2;
  const before = guessLanguage(texts.join("\n")), after = guessLanguage(all);
  return after !== null && after !== "other" && after !== language && after === before;
}

/**
 * Messages, bulletins and notes that come in a month (not the family's own messages), from the last 90 days, or from as
 * far back as the app has them when that's less, but at least a month: what a month's translations would cost.
 */
export function itemsPerMonth(items: { at: Date; own?: boolean }[], now = Date.now()): number {
  const day = 86_400_000;
  const theirs = items.filter((i) => !i.own && i.at.getTime() <= now);
  const recent = theirs.filter((i) => i.at.getTime() >= now - 90 * day);
  if (!recent.length) return 0;
  const earliest = Math.min(...theirs.map((i) => i.at.getTime()));
  const days = Math.min(90, Math.max(30, (now - earliest) / day));
  return (recent.length / days) * 30.4;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["from", "title", "texts"],
  properties: {
    from: { type: "string" },
    title: { type: "string" },
    texts: { type: "array", items: { type: "string" } },
  },
};

/**
 * Translate a title and its texts (a thread's messages, in order), or give the one already made. `options` is for the
 * eval suite, which compares models and efforts (evals/translate.ts).
 */
export async function translate(
  title: string,
  texts: string[],
  language: TranslationLanguage,
  options: { model?: string; effort?: "none" | "low" | "medium" } = {}
): Promise<Translation> {
  const settings = getState().settings;
  const model = options.model ?? translationModel(settings);
  const key = keyOf(model, language, title, texts);
  const before = (await keptTranslations())[key];
  if (before) return before;
  const generation = resetScope();
  const answer = await respond<{ from: string; title: string; texts: string[] }>({
    name: "translation",
    instructions: instructions(language),
    input: JSON.stringify({ title, texts }),
    schema: SCHEMA,
    effort: options.effort ?? leastEffort(model),
    model,
  });
  if (answer.texts.length !== texts.length) throw new Error(`The translation came back with ${answer.texts.length} texts for ${texts.length}.`);
  if (untranslated(texts, answer.texts, language)) {
    // Luna sometimes gives a long text back as it was (a Swedish bulletin, into Finnish): Sol, once, then an error.
    if (model !== "gpt-6.1-sol") return translate(title, texts, language, { model: "gpt-6.1-sol" });
    throw new Error("It came back in the original language.");
  }
  const translation: Translation = { language, model, from: answer.from, title: answer.title, texts: answer.texts, at: Date.now() };
  if (generation === resetScope()) keep(key, translation);
  return translation;
}
