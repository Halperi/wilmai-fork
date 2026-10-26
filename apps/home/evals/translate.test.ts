import "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { guessLanguage, itemsPerMonth, translationTarget } from "../src/ai/translate.ts";
import { DEFAULT_SETTINGS } from "../src/data/model.ts";

// Made-up texts, as Wilma's messages read.
test("a message's language is guessed from its letters and common words", () => {
  assert.equal(guessLanguage("Hei! Huomenna koulu alkaa klo 10.15, ja aamupäiväkerho on auki normaalisti. Terveisin Laura"), "fi");
  assert.equal(guessLanguage("Hej! På fredag åker vi till Noux. Ta med matsäck och kläder efter väder. Hälsningar Anna"), "sv");
  assert.equal(guessLanguage("Hi! On Friday the class is going to Nuuksio. Please bring a packed lunch and clothes for the weather."), "en");
  assert.equal(guessLanguage("Привіт! У п'ятницю клас їде до Нуксіо. Візьміть із собою їжу та одяг за погодою."), "uk");
  assert.equal(guessLanguage("Привет! В пятницу класс едет в Нуксио. Возьмите с собой еду и одежду по погоде."), "other");
  assert.equal(guessLanguage("مرحبا! يوم الجمعة يذهب الصف إلى نوكسيو. أحضروا وجبة غداء وملابس مناسبة للطقس."), "ar");
  // Too short, or nothing to tell by: the button shows.
  assert.equal(guessLanguage("OK"), null);
  assert.equal(guessLanguage("7G 30.10. B204 14.15"), null);
});

test("translation comes with OpenAI: off without it, else the language chosen or the app's", () => {
  assert.equal(translationTarget({ ...DEFAULT_SETTINGS }), null);
  const ai = { ...DEFAULT_SETTINGS, aiProvider: "openai" as const, openaiKey: "sk-test" };
  assert.equal(translationTarget({ ...ai, language: "fi" }), "fi");
  assert.equal(translationTarget({ ...ai, language: "en", translateTo: "uk" }), "uk");
  assert.equal(translationTarget({ ...ai, translateTo: "off" }), null);
  assert.equal(translationTarget({ ...DEFAULT_SETTINGS, aiProvider: "local", translateTo: "sv" }), null);
});

test("a month's items come from the last 90 days, or as far back as there are, at least a month", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  const daysAgo = (n: number, own = false) => ({ at: new Date(now - n * 86_400_000), own });
  // 90 items over 90 days (and one older, and the family's own replies, left out): about 30 a month.
  const steady = [...Array.from({ length: 90 }, (_, i) => daysAgo(i + 0.5)), daysAgo(120), daysAgo(3, true), daysAgo(4, true)];
  assert.equal(Math.round(itemsPerMonth(steady, now)), 30);
  // A new app with ten days of items: counted over a month, not stretched to one.
  assert.equal(Math.round(itemsPerMonth(Array.from({ length: 10 }, (_, i) => daysAgo(i + 0.5)), now)), 10);
  assert.equal(itemsPerMonth([], now), 0);
});
