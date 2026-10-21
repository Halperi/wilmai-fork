/*
 * The thresholds, from the answers already given: no calls. The suite's
 * results keep every reading and decision with its probabilities, so the
 * same answers can be scored again with other thresholds (where an event is
 * sure, a suggestion, or left out; where a later item's word removes one).
 *
 *  - Calibration: do the probabilities mean what they say? Events the cases
 *    call right or wrong, steps required or not, needs-you yes or no, by
 *    probability band: how often each band was right.
 *  - Tuning, cross-checked: the cases are split in two halves; thresholds
 *    tuned on one half (a step at a time from the app's) are scored on the
 *    other. Only a gain that holds on the half it wasn't tuned on counts.
 *
 *   pnpm calibrate                       # the newest full results of every config that has them
 *   pnpm calibrate --config luna-medium,choices
 *
 * The report: evals/results/calibration-latest.md.
 */
import { RealDate, setNow } from "./shim.ts";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const asked = (args.includes("--config") ? args[args.indexOf("--config") + 1] : "").split(",").filter(Boolean);

const { loadSuite, snapshotOf, scoreCase, at, buildFeed, kinds } = await import("./lib.ts");
const { LUNA_THRESHOLDS } = await import("../src/data/model.ts");
type Case = import("./lib.ts").Case;
type Scored = import("./lib.ts").Scored;
type LunaThresholds = import("../src/data/model.ts").LunaThresholds;
type LunaRecord = import("../src/data/model.ts").LunaRecord;
type JevRecord = import("../src/data/model.ts").JevRecord;

const cases = new Map(loadSuite(here).map((c) => [c.id, c]));
const resultsDir = join(here, "results");

// The newest full results (every run's readings) of each config.
const files = readdirSync(resultsDir)
  .filter((f) => /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-.+\.json$/.test(f) && !f.endsWith("-matrix.json"))
  .sort();
const newest = new Map<string, string>();
for (const f of files) newest.set(f.slice(17, -5), f);
const chosen = [...newest].filter(([name]) => (asked.length ? asked.includes(name) : true));
if (!chosen.length) throw new Error(`No results to calibrate${asked.length ? ` for ${asked.join(", ")}` : ""} in evals/results/`);

/** One case as answered in one run of one config: the state, the feed built once. */
interface Answered {
  config: string;
  c: Case;
  state: Scored;
  feed: ReturnType<typeof buildFeed>;
}
const answered: Answered[] = [];
for (const [config, file] of chosen) {
  const data = JSON.parse(readFileSync(join(resultsDir, file), "utf8")) as { runs: { id: string; readings?: Record<string, LunaRecord>; decisions?: Record<string, JevRecord> }[][] };
  for (const run of data.runs)
    for (const r of run) {
      const c = cases.get(r.id);
      if (!c || !r.readings) continue;
      setNow(at(c.today).getTime());
      const state: Scored = { snapshot: snapshotOf(c), jev: r.decisions ?? {}, luna: r.readings, local: { opened: {}, done: {} } };
      answered.push({ config, c, state, feed: buildFeed(state) });
    }
}

/** Calendar checks passed with these thresholds (the case's clock set for each). */
function score(list: Answered[], T: LunaThresholds): { ok: number; n: number } {
  let ok = 0;
  let n = 0;
  for (const a of list) {
    if (!a.c.expect.calendar) continue;
    setNow(at(a.c.today).getTime());
    for (const x of scoreCase(a.c, a.state, T, a.feed).checks) {
      if (x.task !== "calendar" || x.gap) continue;
      n += 1;
      if (x.ok) ok += 1;
    }
  }
  return { ok, n };
}

// ---- Tuning: a step at a time from the app's thresholds, on one half; scored on the other ----
const GRID: Record<keyof LunaThresholds, number[]> = {
  sureDate: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9],
  sureCalendar: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9],
  keepDate: [0.2, 0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7],
  keepCalendar: [0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7],
  superseded: [0.4, 0.5, 0.6, 0.7, 0.8],
};
const valid = (T: LunaThresholds) => T.keepDate <= T.sureDate && T.keepCalendar <= T.sureCalendar;

function tune(list: Answered[]): LunaThresholds {
  let best = { ...LUNA_THRESHOLDS };
  let bestScore = score(list, best).ok;
  for (let sweep = 0; sweep < 4; sweep += 1) {
    let moved = false;
    for (const key of Object.keys(GRID) as (keyof LunaThresholds)[]) {
      for (const v of GRID[key]) {
        const T = { ...best, [key]: v };
        if (!valid(T) || v === best[key]) continue;
        const s = score(list, T).ok;
        // Only a clear gain moves a threshold (a tie keeps the app's).
        if (s > bestScore) {
          best = T;
          bestScore = s;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return best;
}

// Two halves by the case's id (the same split every time).
const half = (id: string) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 2;
const configs = [...new Set(answered.map((a) => a.config))];
const pct = ({ ok, n }: { ok: number; n: number }) => (n ? `${((100 * ok) / n).toFixed(1)} %` : "–");
const showT = (T: LunaThresholds) =>
  (Object.keys(GRID) as (keyof LunaThresholds)[])
    .filter((k) => T[k] !== LUNA_THRESHOLDS[k])
    .map((k) => `${k} ${LUNA_THRESHOLDS[k]} → ${T[k]}`)
    .join(", ") || "as the app's";

const lines: string[] = [`# Calibration · ${new RealDate().toISOString().slice(0, 16).replace("T", " ")}`, ""];
lines.push(
  `From the results already run (no calls): ${chosen.map(([n, f]) => `${n} (${f.slice(0, 16)})`).join(", ")}. The app's thresholds: ${(Object.keys(GRID) as (keyof LunaThresholds)[]).map((k) => `${k} ${LUNA_THRESHOLDS[k]}`).join(", ")}.`,
  ""
);
lines.push("## Tuning the calendar's thresholds, cross-checked", "");
lines.push("Calendar checks passed. Tuned on one half of the cases, scored on the other: a gain counts only there.", "");
lines.push("| Config | App's thresholds | Tuned on half A, scored on B | Tuned on B, scored on A | Tuned on all | Tuned on all: what moved |", "| --- | ---: | ---: | ---: | ---: | --- |");
for (const config of [...configs, "all configs"]) {
  const mine = config === "all configs" ? answered : answered.filter((a) => a.config === config);
  const A = mine.filter((a) => half(a.c.id) === 0);
  const B = mine.filter((a) => half(a.c.id) === 1);
  const now = score(mine, LUNA_THRESHOLDS);
  const tA = tune(A);
  const tB = tune(B);
  const onB = score(B, tA);
  const onA = score(A, tB);
  const baseB = score(B, LUNA_THRESHOLDS);
  const baseA = score(A, LUNA_THRESHOLDS);
  const all = tune(mine);
  const delta = (s: { ok: number }, base: { ok: number }) => `${s.ok - base.ok >= 0 ? "+" : ""}${s.ok - base.ok}`;
  lines.push(
    `| ${config} | ${pct(now)} (${now.ok}/${now.n}) | ${pct(onB)} (${delta(onB, baseB)}) | ${pct(onA)} (${delta(onA, baseA)}) | ${pct(score(mine, all))} | ${showT(all)} |`
  );
  console.log(`${config}: app ${pct(now)}; tuned elsewhere ${delta(onB, baseB)} on B, ${delta(onA, baseA)} on A; tuned on all: ${showT(all)}`);
}
lines.push("");

// ---- Calibration: how often each probability band was right ----
type Point = { p: number; right: boolean };
const points: Record<string, Point[]> = { "event is the family's (pCalendar)": [], "event, both (min of pDate, pCalendar)": [], "step required (pRequired)": [], "needs you (first answer)": [], "a later item cancels or moves it": [] };
for (const a of answered) {
  const { c, state } = a;
  const snap = state.snapshot;
  const cal = c.expect.calendar;
  const keyOf = (id: number) => {
    const item = c.items.find((i) => i.id === id);
    return item?.type === "message" ? `m:${id}` : item?.type === "news" ? `n:${id}` : "";
  };
  for (const rec of Object.values(state.luna)) {
    for (const e of rec.events) {
      const forPupil = (i?: number) => i === undefined || !e.pupils || e.pupils.includes(snap.children[i].number);
      const right = (cal?.events ?? []).some((w) => w.date === e.date && (!kinds(w.kind) || kinds(w.kind)!.includes(e.kind)) && forPupil(w.pupil));
      const wrong = (cal?.not ?? []).some(
        (n) =>
          n.pupil === undefined &&
          e.date <= n.date &&
          (e.endDate ?? e.date) >= n.date &&
          (!kinds(n.kind) || kinds(n.kind)!.includes(e.kind)) &&
          (n.start === undefined || e.start === n.start)
      );
      if (right === wrong) continue;
      points["event is the family's (pCalendar)"].push({ p: e.pCalendar, right });
      points["event, both (min of pDate, pCalendar)"].push({ p: Math.min(e.pDate, e.pCalendar), right });
    }
    for (const [, l] of Object.entries(rec.links?.about ?? {})) {
      // A link is right to remove an event the case says must not be there, wrong to remove one it says must be.
      const date = l.what.slice(0, 10);
      const gone = (cal?.not ?? []).some((n) => n.date === date && n.pupil === undefined);
      const kept = (cal?.events ?? []).some((w) => w.date === date);
      if (gone !== kept) points["a later item cancels or moves it"].push({ p: l.cancelled + l.moved, right: gone });
    }
  }
  for (const want of c.expect.action ?? []) {
    const rec = state.luna[keyOf(want.item)];
    if (!rec?.action || (want.none === undefined && want.quote === undefined)) continue;
    points["step required (pRequired)"].push({ p: rec.action.pRequired, right: !want.none });
  }
  for (const t of c.expect.triage ?? []) {
    const a2 = state.jev[keyOf(t.item)]?.answers.needs_action;
    if (t.needs_action === undefined || a2?.type !== "noul") continue;
    points["needs you (first answer)"].push({ p: a2.noul, right: t.needs_action });
  }
}
const BANDS = [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0001];
lines.push("## Do the probabilities mean what they say?", "");
lines.push("For each question, the answers the cases can judge, by band: how many, and how often the thing was so (the yes share). A well-calibrated band's share sits inside it. Brier: the mean squared miss (0 is perfect, 0.25 a coin).", "");
for (const [what, ps] of Object.entries(points)) {
  if (!ps.length) continue;
  const brier = ps.reduce((s, x) => s + (x.p - (x.right ? 1 : 0)) ** 2, 0) / ps.length;
  lines.push(`**${what}** (${ps.length} answers, Brier ${brier.toFixed(3)})`, "", "| Band | Answers | Yes share |", "| --- | ---: | ---: |");
  for (let b = 0; b < BANDS.length - 1; b += 1) {
    const inBand = ps.filter((x) => x.p >= BANDS[b] && x.p < BANDS[b + 1]);
    if (!inBand.length) continue;
    lines.push(`| ${BANDS[b].toFixed(1)}–${Math.min(1, BANDS[b + 1]).toFixed(1)} | ${inBand.length} | ${Math.round((100 * inBand.filter((x) => x.right).length) / inBand.length)} % |`);
  }
  lines.push("");
}
const out = join(resultsDir, "calibration-latest.md");
writeFileSync(out, lines.join("\n"));
console.log(`Report: evals/results/calibration-latest.md`);
