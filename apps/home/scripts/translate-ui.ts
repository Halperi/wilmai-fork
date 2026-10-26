/*
 * The app's own words in another language, from the Finnish dictionaries (src/i18n/fi-*.ts): each English key is
 * translated with the Finnish beside it for reference, by GPT-6.1 Sol, and written to src/i18n/<lang>-*.ts in the
 * Finnish file's order and layout, comments and all. Placeholders ({name}) and the *marked* parts are checked; an entry
 * that comes back without them is asked again on its own. A language's existing entries are kept (only new keys are
 * translated) unless --all. Machine translation: a speaker of the language reads the result before a release.
 *
 *   op run --env-file evals/keys.env -- pnpm ui:translate --lang sv
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../src/i18n");
const args = process.argv.slice(2);
const lang = args[args.indexOf("--lang") + 1];
const LANGUAGES: Record<string, { name: string; guide: string }> = {
  sv: {
    name: "Finland Swedish",
    guide:
      "Write as Finland's Swedish-speaking schools and Wilma's Swedish version do: vårdnadshavare (guardian), elev, klassföreståndare, studiehandledare, prov, läxor, frånvaro, schema, vitsord (grades), lektionsanteckningar (teachers' notes on lessons). Address the reader as du. Amounts in dollars as in the Finnish: 0,50–3 dollar.",
  },
};
if (!LANGUAGES[lang]) throw new Error(`--lang ${Object.keys(LANGUAGES).join("|")}`);
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) throw new Error("OPENAI_API_KEY isn't set (op run --env-file evals/keys.env -- pnpm ui:translate --lang sv)");
const all = args.includes("--all");

/** An entry: `  key: "value",` or `  "key":\n    "value",` */
const ENTRY = /^(\s+)("(?:[^"\\]|\\.)*"|[A-Za-z_$][\w$]*)(:\s*)"((?:[^"\\]|\\.)*)"/gm;
const keyOf = (raw: string) => (raw.startsWith('"') ? (JSON.parse(raw) as string) : raw);
const placeholders = (s: string) => [...s.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort().join(" ");
const marks = (s: string) => `${(s.match(/\*\*/g) ?? []).length}/${(s.replace(/\*\*/g, "").match(/\*/g) ?? []).length}`;
const valid = (en: string, out: string) => placeholders(en) === placeholders(out) && marks(en) === marks(out) && out.trim().length > 0;

async function ask(entries: { en: string; fi: string }[]): Promise<string[]> {
  const { name, guide } = LANGUAGES[lang];
  const body = {
    model: "gpt-6.1-sol",
    reasoning: { effort: "low" },
    store: false,
    instructions: [
      `You translate the user interface of WilmAI Home, a desktop app for Finland's Wilma school system used by parents and pupils, into ${name}.`,
      `The input is a JSON array of entries: "en" is the app's English text, "fi" its Finnish translation, for reference. Answer with one ${name} translation per entry, in order.`,
      guide,
      `Short, plain and natural, as an app's buttons, headings and help say it; keep the tone of the English.`,
      `Keep every placeholder in braces ({name}, {n}) exactly as written. Keep *one asterisk* and **two asterisks** around the words they mark, as markup.`,
      `Keep product names (WilmAI, WilmAI Home, Wilma, OpenAI, GPT-6 Luna, GPT-6.1 Sol, Jev), keys in brackets like (E) or (P), and symbols as they are.`,
      `An English text ending in a sense in brackets, like "Done (list)" or "New (one item)", is that word in that sense (the Finnish shows which): translate the word for the sense, without the bracket.`,
      `Entries for one and for many ({n}) are separate: give each its own form.`,
    ].join("\n"),
    input: JSON.stringify(entries),
    text: {
      format: {
        type: "json_schema",
        name: "ui",
        strict: true,
        schema: { type: "object", additionalProperties: false, required: ["translations"], properties: { translations: { type: "array", items: { type: "string" } } } },
      },
    },
  };
  for (let attempt = 1; ; attempt++) {
    const resp = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (resp.ok) {
      const data = (await resp.json()) as { output: { content?: { type: string; text?: string }[] }[] };
      const text = data.output.flatMap((o) => o.content ?? []).find((c) => c.type === "output_text")?.text ?? "{}";
      const out = (JSON.parse(text) as { translations?: string[] }).translations ?? [];
      if (out.length === entries.length) return out;
      if (attempt >= 3) throw new Error(`${out.length} translations for ${entries.length} entries`);
    } else if (attempt >= 4 || (resp.status < 500 && resp.status !== 429)) {
      throw new Error(`OpenAI ${resp.status}: ${await resp.text()}`);
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

let asked = 0;
for (const file of readdirSync(dir).filter((f) => /^fi-.*\.ts$/.test(f)).sort()) {
  const source = readFileSync(join(dir, file), "utf8");
  const target = join(dir, file.replace(/^fi-/, `${lang}-`));
  const before: Record<string, string> = {};
  if (existsSync(target) && !all) for (const m of readFileSync(target, "utf8").matchAll(ENTRY)) before[keyOf(m[2])] = JSON.parse(`"${m[4]}"`) as string;
  const entries = [...source.matchAll(ENTRY)].map((m) => ({ en: keyOf(m[2]), fi: JSON.parse(`"${m[4]}"`) as string }));
  const todo = entries.filter((e) => before[e.en] === undefined);
  const done: Record<string, string> = { ...before };
  for (let i = 0; i < todo.length; i += 60) {
    const batch = todo.slice(i, i + 60);
    const out = await ask(batch);
    asked += batch.length;
    for (const [j, e] of batch.entries()) {
      let text = out[j];
      // Missing a placeholder or a mark: once more on its own, else the English stays (and is listed below).
      if (!valid(e.en, text)) text = (await ask([e]))[0];
      if (valid(e.en, text)) done[e.en] = text;
      else {
        done[e.en] = e.en;
        console.warn(`${file}: kept in English, the translation lost a placeholder or a mark: ${e.en}`);
      }
    }
    console.log(`${file}: ${Math.min(i + 60, todo.length)}/${todo.length}`);
  }
  // The Finnish file, with each value replaced, and its names and header in the new language's.
  const upper = lang.toUpperCase();
  const written = source
    .replace(ENTRY, (whole, indent: string, rawKey: string, sep: string) => {
      const value = done[keyOf(rawKey)];
      return value === undefined ? whole : `${indent}${rawKey}${sep}${JSON.stringify(value)}`;
    })
    .replace(/export const FI_(\w+)/, `export const ${upper}_$1`)
    .replace(/^\/\* Finnish for/m, `/* ${lang === "sv" ? "Swedish" : lang} for`);
  writeFileSync(target, written);
}
console.log(`${asked} entries translated into ${LANGUAGES[lang].name}.`);
