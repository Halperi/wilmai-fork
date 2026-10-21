/*
 * The experiment's comparison on the family's real inbox: are Luna's
 * decisions like Jev's? Jev's own answers were put aside before Luna took
 * over (the baseline, state.jevBaseline). For every item whose content
 * hasn't changed since (same question set, same hash), each question's
 * answers are compared: a choice agrees when both chose the same option; a
 * yes/no when both are on the same side of the app's threshold (0.6 for
 * "needs you", 0.5 otherwise), with how far apart the probabilities are.
 * Then Luna's reading: the calendar's events for the next eight weeks.
 * Agreement isn't correctness: the eval suite (evals/) has right answers.
 *
 * Also written: the material (luna-material.json), every item with what was
 * read from it, for turning real patterns into made-up eval cases. All of
 * it goes to the app's data folder on this computer (desktop app), nothing
 * is sent.
 */
import { accountScope, getState } from "../data/store";
import { buildFeed, noteGroups, NEEDS_YOU } from "../data/feed";
import { calendarEvents, type CalEvent } from "../data/calendar";
import { addDays, shortDate, today } from "../data/dates";
import type { JevAnswer, JevRecord } from "../data/model";
import { saveReport } from "../wilma/transport";
import { examMark, markKey } from "../data/marks";
import { resultKey } from "../data/grades";
import { LUNA } from "./client";

interface Pair {
  key: string;
  qs: string;
  name: string;
  group: string;
  jev: JevAnswer;
  luna: JevAnswer;
}

interface GroupStat {
  qs: string;
  group: string;
  n: number;
  agree: number;
  /** Yes/no: the mean distance between the two probabilities. */
  meanDiff: number | null;
}

/** "what_D3" and "date_D1" are one question asked of many dates. */
const groupOf = (name: string) => name.replace(/_[A-Z]\d+$/, "");

const threshold = (group: string) => (group === "needs_action" ? NEEDS_YOU : 0.5);

function agrees(p: Pair): boolean {
  if (p.jev.type === "choice" && p.luna.type === "choice") return p.jev.choice === p.luna.choice;
  if (p.jev.type === "noul" && p.luna.type === "noul") return p.jev.noul >= threshold(p.group) === p.luna.noul >= threshold(p.group);
  if (p.jev.type === "score" && p.luna.type === "score") return Math.round(p.jev.score) === Math.round(p.luna.score);
  return false;
}

const show = (a: JevAnswer) =>
  a.type === "choice" ? `${a.choice} (${(a.probabilities[a.choice] ?? a.confidence).toFixed(2)})` : a.type === "noul" ? a.noul.toFixed(2) : a.score.toFixed(1);

/** Pairs of answers to the same question about the same, unchanged item. */
function pairs(baseline: Record<string, JevRecord>, now: Record<string, JevRecord>): Pair[] {
  const out: Pair[] = [];
  for (const [key, before] of Object.entries(baseline)) {
    const after = now[key];
    if (!after || after.model !== LUNA || after.qs !== before.qs || after.hash !== before.hash) continue;
    for (const [name, jev] of Object.entries(before.answers)) {
      const luna = after.answers[name];
      if (luna) out.push({ key, qs: before.qs, name, group: groupOf(name), jev, luna });
    }
  }
  return out;
}

/** The calendar's read events (not Wilma's own exams, changed days and sign-ups, which are the same either way). */
const readEvents = (events: CalEvent[]) => events.filter((e) => !/^(exam|day|invite|signup):/.test(e.key));


export function compareWithJev(): { markdown: string; json: unknown } | null {
  const state = getState();
  const { snapshot, jevBaseline, jev, luna, local } = state;
  if (!snapshot || !Object.keys(jevBaseline).length) return null;
  const all = pairs(jevBaseline, jev);
  const feed = buildFeed({ snapshot, local: state.local, jev, luna });
  const titleOf = (key: string) => {
    const base = key.split("#")[0];
    return feed.find((i) => i.key === base)?.title ?? base;
  };

  // Each question's agreement, the app's own decisions first.
  const groups = new Map<string, GroupStat>();
  for (const p of all) {
    const id = `${p.qs}|${p.group}`;
    const g = groups.get(id) ?? { qs: p.qs, group: p.group, n: 0, agree: 0, meanDiff: null };
    g.n += 1;
    if (agrees(p)) g.agree += 1;
    if (p.jev.type === "noul" && p.luna.type === "noul") g.meanDiff = ((g.meanDiff ?? 0) * (g.n - 1) + Math.abs(p.jev.noul - p.luna.noul)) / g.n;
    groups.set(id, g);
  }
  const stats = [...groups.values()].sort((a, b) => a.qs.localeCompare(b.qs) || b.n - a.n);
  const differ = all.filter((p) => !agrees(p));

  // Luna's reading: the calendar for the next eight weeks.
  const now = today();
  const range = { from: now, until: addDays(now, 56), children: [] as string[] };
  const fromLuna = readEvents(calendarEvents(snapshot, feed, local.calendar, range, luna));
  const name = (n: string) => snapshot.children.find((c) => c.number === n)?.first ?? n;
  const line = (e: CalEvent) => `${shortDate(e.date)}${e.start ? ` ${e.start}` : ""} ${e.children.map(name).join(", ")}: ${e.title} (${e.kind}${e.sure ? "" : ", suggestion"})`;

  const pct = (a: number, n: number) => (n ? `${Math.round((100 * a) / n)} %` : "–");
  const md: string[] = [];
  md.push(`# Luna compared with Jev (${new Date().toISOString().slice(0, 16).replace("T", " ")})`, "");
  md.push(`Jev's answers kept: ${Object.keys(jevBaseline).length} items. Luna has answered the same questions about ${new Set(all.map((p) => p.key)).size} of them unchanged since (${all.length} answers).`, "");
  md.push("## Agreement by question", "", "| Question set | Question | Compared | Same answer | Mean distance (yes/no) |", "| --- | --- | ---: | ---: | ---: |");
  for (const g of stats) md.push(`| ${g.qs} | ${g.group} | ${g.n} | ${pct(g.agree, g.n)} | ${g.meanDiff === null ? "" : g.meanDiff.toFixed(2)} |`);
  md.push("", "## Where they differ (up to 12 per question)", "");
  for (const g of stats) {
    const list = differ.filter((p) => p.qs === g.qs && p.group === g.group).slice(0, 12);
    if (!list.length) continue;
    md.push(`### ${g.qs} · ${g.group}`, "", "| Item | Question | Jev | Luna |", "| --- | --- | --- | --- |");
    for (const p of list) md.push(`| ${titleOf(p.key).replace(/\|/g, "/").slice(0, 70)} | ${p.name} | ${show(p.jev)} | ${show(p.luna)} |`);
    md.push("");
  }
  md.push("", "## Luna's reading: the calendar, next eight weeks", "");
  for (const e of fromLuna) md.push(`- ${line(e)}`);

  const json = {
    at: Date.now(),
    baseline: Object.keys(jevBaseline).length,
    compared: new Set(all.map((p) => p.key)).size,
    stats,
    differ: differ.map((p) => ({ key: p.key, item: titleOf(p.key), qs: p.qs, name: p.name, jev: p.jev, luna: p.luna })),
    calendar: fromLuna.map(line),
  };
  return { markdown: md.join("\n"), json };
}

/**
 * Every item with what was read from it: the text, the decisions (needs you,
 * kind, scope, tone, a mark's kind and level) and Luna's reading (the step,
 * its deadline, the events). The family's own data, kept on this computer:
 * the source for made-up eval cases that keep the real patterns.
 */
export function material(): unknown {
  const { snapshot, jev, luna } = getState();
  if (!snapshot) return null;
  const name = (numbers: string[]) => numbers.map((n) => snapshot.children.find((c) => c.number === n)?.first ?? n);
  const decided = (key: string) => {
    const a = jev[key]?.answers ?? {};
    return Object.fromEntries(Object.entries(a).map(([q, x]) => [q, x.type === "choice" ? `${x.choice} ${x.confidence.toFixed(2)}` : x.type === "noul" ? x.noul.toFixed(2) : x.score.toFixed(2)]));
  };
  const read = (key: string) => {
    const r = luna[key];
    return r ? { model: r.model, action: r.action ?? null, nextLessonExam: r.nextLessonExam ?? null, events: r.events, dropped: r.dropped, error: r.error ?? null } : null;
  };
  return {
    at: new Date().toISOString(),
    children: snapshot.children.map((c) => c.first),
    messages: Object.values(snapshot.messages).map((m) => ({ key: `m:${m.id}`, sent: m.sentAt, from: m.sender, subject: m.subject, pupils: name(m.children), text: m.thread?.content ?? null, decided: decided(`m:${m.id}`), read: read(`m:${m.id}`) })),
    news: Object.values(snapshot.news).map((n) => ({ key: `n:${n.id}`, published: n.published, from: n.author, title: n.title, pupils: name(n.children), text: n.detail?.content ?? null, decided: decided(`n:${n.id}`), read: read(`n:${n.id}`) })),
    notes: snapshot.children.flatMap((c) =>
      noteGroups(c.number, snapshot.perChild[c.number]?.notes ?? [])
        .filter((g) => g.note)
        .map((g) => ({ key: g.key, pupil: c.first, date: g.date, start: g.start, end: g.end, subjects: g.subjects, kind: g.typeLabel, text: g.note, decided: decided(g.key), read: read(g.key) }))
    ),
    marks: snapshot.children.flatMap((c) =>
      (snapshot.perChild[c.number]?.pastExams?.exams ?? []).map((e) => {
        const key = markKey(resultKey(c.number, e));
        return { key, pupil: c.first, date: e.date, subject: e.subject, name: e.name, grade: e.grade, info: e.info, decided: decided(key), maximum: jev[key]?.meta?.maximum ?? null, shown: examMark(e, jev[key]) };
      })
    ),
  };
}

/** Write the comparison and the material to the app's data folder (desktop app only; quietly nothing elsewhere). */
export async function saveCompareReport(): Promise<string | null> {
  const scope = accountScope();
  const stuff = material();
  if (stuff) await saveReport("luna-material.json", JSON.stringify(stuff, null, 2)).catch(() => null);
  if (scope !== accountScope()) return null;
  const report = compareWithJev();
  if (!report) return null;
  await saveReport("luna-compare.json", JSON.stringify(report.json, null, 2)).catch(() => null);
  if (scope !== accountScope()) return null;
  return saveReport("luna-compare.md", report.markdown).catch(() => null);
}
