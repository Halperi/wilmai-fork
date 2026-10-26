/*
 * Translations (src/ai/translate.ts), against OpenAI: made-up messages in Finnish and Swedish, each translated into the
 * other languages offered, by each model asked. Checks what must come through exactly (names, classes, times, dates'
 * numbers, links, amounts), that there's a translation per text, that "from" names the right language, and that the
 * translation is in the language asked. Prints the checks and the cost, and saves the translations to read by eye.
 *
 *   op run --env-file evals/keys.env -- pnpm eval:translate                          # Sol, at its least reasoning
 *   op run --env-file evals/keys.env -- pnpm eval:translate --models gpt-6.1-sol,gpt-6-luna --effort low
 */
import { RealDate } from "./shim.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const { overrideBridge } = await import("../src/wilma/transport.ts");
const store = await import("../src/data/store.ts");
const { DEFAULT_SETTINGS } = await import("../src/data/model.ts");
const { costOf, totalUsage } = await import("../src/luna/client.ts");
const { translate, guessLanguage } = await import("../src/ai/translate.ts");
type TranslationLanguage = import("../src/data/model.ts").TranslationLanguage;

const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY isn't set (op run --env-file evals/keys.env -- pnpm eval:translate)");
overrideBridge(async (path, init) => {
  if (path !== "openai") return { error: `The eval suite has no route ${path}`, status: 404 };
  const resp = await fetch(`https://api.openai.com${init.headers?.["x-openai-path"]}`, {
    method: "POST",
    headers: { authorization: `Bearer ${OPENAI_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(init.body),
  });
  return { status: resp.status, retryAfter: resp.headers.get("retry-after"), body: await resp.text() };
});

interface Case {
  name: string;
  from: TranslationLanguage;
  title: string;
  texts: string[];
  /** Must come through exactly as written, in every translation. */
  keep: string[];
}

// Made up: no real school, pupil or teacher.
const CASES: Case[] = [
  {
    name: "fi-trip",
    from: "fi",
    title: "Retki Nuuksioon pe 30.10.",
    texts: [
      "Hei 7G:n huoltajat!\n\nLähdemme perjantaina 30.10. retkelle Nuuksioon. Lähtö koululta klo 8.15 ja paluu noin klo 14.30.\n\nMukaan: eväät, juomapullo ja säänmukainen vaatetus. Bussimatka maksaa 5 €, jonka voi maksaa Wilman Lomakkeet-sivulla 27.10. mennessä.\n\nLisätietoa: https://example.org/retki\n\nTerveisin\nLaura Mäkelä",
    ],
    keep: ["7G", "30.10", "8.15", "14.30", "5 €", "27.10", "https://example.org/retki", "Laura Mäkelä"],
  },
  {
    name: "sv-trip",
    from: "sv",
    title: "Utflykt till Noux fredag 30.10",
    texts: [
      "Hej vårdnadshavare i 7G!\n\nPå fredag 30.10 åker vi på utflykt till Noux nationalpark. Vi samlas vid skolan kl. 8.15 och är tillbaka ca kl. 14.30.\n\nTa med matsäck, vattenflaska och kläder efter väder. Bussresan kostar 5 €, betala senast 27.10 via Blanketter i Wilma.\n\nHälsningar\nAnna Lindqvist",
    ],
    keep: ["7G", "30.10", "8.15", "14.30", "5 €", "27.10", "Anna Lindqvist"],
  },
  {
    name: "fi-thread",
    from: "fi",
    title: "Uusintakoe",
    texts: [
      "Hei,\n\nVeeti oli poissa matematiikan kokeesta. Uusintakoe on tiistaina 3.11. klo 14.15 luokassa B204. Ilmoitathan, sopiiko aika.\n\nMikko Laine",
      "Kiitos tiedosta! Aika sopii, Veeti tulee paikalle.\n\nSari Esimerkki",
      "Hienoa, nähdään tiistaina. Muistakaa laskin ja kaavakirja.\n\nMikko Laine",
    ],
    keep: ["Veeti", "3.11", "14.15", "B204", "Mikko Laine", "Sari Esimerkki"],
  },
  {
    name: "sv-bulletin",
    from: "sv",
    title: "Föräldramöte för årskurs 9 den 12.11",
    texts: [
      "Bästa vårdnadshavare,\n\nVi bjuder in till föräldramöte för årskurs 9 torsdagen den 12.11 kl. 18.00–19.30 i skolans aula. På mötet berättar studiehandledaren om den gemensamma ansökan till andra stadiet, och klassföreståndarna presenterar vårens prov och evenemang.\n\nAnmäl dig senast 6.11 via Blanketter i Wilma (\"Föräldramöte åk 9\"). Kaffe och smörgås serveras från kl. 17.45, och ni kan också träffa lärarna efter mötet.\n\nOm ni inte kan delta, finns presentationen i Wilma efter mötet. Frågor kan skickas till studiehandledaren Johan Berg via Wilma.\n\nVälkomna!\nRektor Maria Holm",
    ],
    keep: ["12.11", "18.00", "19.30", "6.11", "17.45", "Johan Berg", "Maria Holm"],
  },
  {
    name: "fi-note",
    from: "fi",
    title: "Tuntimerkintä",
    texts: ["Unohti kirjat kotiin. Kotitehtävät tekemättä, tehtävät 4–7 sivulta 52 tehtävä ensi tunniksi."],
    keep: ["4–7", "52"],
  },
];

const TARGETS: TranslationLanguage[] = ["fi", "sv", "en", "uk", "ar"];
const models = (arg("--models") ?? "gpt-6.1-sol").split(",").filter(Boolean);
/** Unset: each model's least (src/ai/translate.ts). */
const effort = arg("--effort") as "none" | "low" | "medium" | undefined;
const SCRIPT: Partial<Record<TranslationLanguage, RegExp>> = { uk: /\p{Script=Cyrillic}/gu, ar: /\p{Script=Arabic}/gu };

interface Row { case: string; to: string; model: string; ok: number; of: number; failed: string[]; cents: number; ms: number }
const rows: Row[] = [];
const saved: Record<string, unknown>[] = [];

for (const model of models) {
  for (const c of CASES) {
    for (const to of TARGETS.filter((l) => l !== c.from)) {
      store.setState({ usage: {}, settings: { ...DEFAULT_SETTINGS, aiProvider: "openai", openaiKey: "from the environment", aiMonthlyBudgetUsd: 3 } });
      const started = RealDate.now();
      const failed: string[] = [];
      let of = 0;
      const check = (ok: boolean, what: string) => {
        of += 1;
        if (!ok) failed.push(what);
      };
      try {
        const tr = await translate(c.title, c.texts, to, { model, effort });
        check(tr.texts.length === c.texts.length, `${tr.texts.length} texts for ${c.texts.length}`);
        check(tr.from.toLowerCase().startsWith(c.from), `from "${tr.from}"`);
        const all = [tr.title, ...tr.texts].join("\n");
        for (const k of c.keep) check(all.includes(k), `kept "${k}"`);
        const script = SCRIPT[to];
        // Most letters in the language's alphabet (names, codes and links stay in theirs).
        if (script) check((all.match(script) ?? []).length > (all.match(/\p{L}/gu) ?? []).length / 2, `in ${to}'s letters`);
        else check(guessLanguage(tr.texts.join("\n")) === to || tr.texts.join(" ").length < 120, `reads as ${to} (${guessLanguage(tr.texts.join("\n"))})`);
        saved.push({ case: c.name, to, model, by: tr.model, effort, from: tr.from, title: tr.title, texts: tr.texts });
      } catch (err) {
        check(false, err instanceof Error ? err.message : String(err));
      }
      const cents = 100 * costOf(totalUsage(store.getState().usage));
      const by = (saved.at(-1) as { case?: string; to?: string; by?: string } | undefined);
      const fellBack = by?.case === c.name && by.to === to && by.by !== model ? ` (${by.by} translated it)` : "";
      rows.push({ case: c.name, to, model, ok: of - failed.length, of, failed, cents, ms: RealDate.now() - started });
      console.log(`${model} ${c.name} → ${to}: ${of - failed.length}/${of}${failed.length ? ` (${failed.join("; ")})` : ""}${fellBack} · ${cents.toFixed(2)} ¢ · ${((RealDate.now() - started) / 1000).toFixed(1)} s`);
    }
  }
}

console.log("");
for (const model of models) {
  const mine = rows.filter((r) => r.model === model);
  const ok = mine.reduce((n, r) => n + r.ok, 0), of = mine.reduce((n, r) => n + r.of, 0);
  const cents = mine.reduce((n, r) => n + r.cents, 0);
  console.log(`${model} (${effort ?? "least"}): ${ok}/${of} checks · ${(cents / mine.length).toFixed(2)} ¢ a translation on average, ${Math.max(...mine.map((r) => r.cents)).toFixed(2)} ¢ the most · ${(mine.reduce((n, r) => n + r.ms, 0) / mine.length / 1000).toFixed(1)} s on average`);
}
mkdirSync(join(here, "results"), { recursive: true });
const file = join(here, "results", `translate-${new RealDate().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`);
writeFileSync(file, JSON.stringify({ models, effort, rows, translations: saved }, null, 2));
console.log(`Translations: ${file}`);
