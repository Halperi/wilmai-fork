import "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";

// bits.tsx also imports the mascot; Node needs an asset URL, while Vite supplies it in the app.
registerHooks({ load(url, context, nextLoad) {
  if (/\.png$/.test(url)) return { format: "module", source: `export default ${JSON.stringify(url)};`, shortCircuit: true };
  return nextLoad(url, context);
} });
const { MobileUsualWeek } = await import("../src/ui/MobileUsualWeek.tsx");
const { togetherLabel } = await import("../src/ui/UsualWeek.tsx");
const { familyChild } = await import("../src/data/logins.ts");

test("phone week keeps both schools' children, readable hours, PE and days without lessons", () => {
  const children = [
    { number: "1001", first: "First", name: "First Example", nick: "Fox", emoji: "🦊", emojiTabs: true, color: 12 },
    { number: familyChild(1, "1002"), first: "Second", name: "Second Example", color: 3 },
  ];
  const rows = [
    { date: "2026-11-02", days: [{ weekday: 0, start: "08:15", end: "13:00", pe: true }, { weekday: 0, start: "08:30", end: "15:00", pe: false }] },
    { date: "2026-11-03", days: [undefined, { weekday: 1, start: "09:00", end: "13:00", pe: false }] },
    ...["2026-11-04", "2026-11-05", "2026-11-06"].map((date) => ({ date, days: [undefined, undefined] })),
  ];
  const $ = load(renderToStaticMarkup(createElement(MobileUsualWeek, { children, rows, labelFor: togetherLabel })));
  assert.equal($(".muw-day").length, 5);
  assert.equal($(".muw-child").length, 10);
  assert.equal($(".muw-day").first().find(".muw-child").first().find("time").text(), "08:1513:00");
  assert.equal($(".muw-day").first().find(".muw-child").last().find("time").text(), "08:3015:00");
  assert.ok($(".muw-child dt").text().includes("Fox") && $(".muw-child dt").text().includes("Second"));
  assert.equal($(".c12 .tab-emoji").first().text(), "🦊");
  assert.equal($(".muw-pe").length, 1);
  assert.equal($(".muw-shared").text(), "Same start");
  assert.equal($(".muw-child dd").filter((_, el) => $(el).text() === "No lessons").length, 7);
});
