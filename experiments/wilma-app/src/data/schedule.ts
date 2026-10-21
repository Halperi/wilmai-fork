/*
 * Unusual school days: a start or finish half an hour or more off the usual
 * (earlier or later), or no lessons on a school day. "Usual" is per weekday: a Friday that always starts at 9:10 is
 * a normal Friday. It's the time most common for that weekday in the weeks
 * the app knows (this, next, and any read in the Week view); on a tie, the
 * one nearest the child's most common time overall.
 */
import type { ScheduleLesson, UpcomingExam } from "@wilma-client/src/core";
import type { ChildData } from "./model";
import { addDays, dateOf, minutes, mondayOf, weekday } from "./dates";

/** Preserve the previous sync's weeks when they leave the two-week window, including an empty known week. */
export function retainedScheduleWeeks(data: ChildData | undefined, syncedAt: Date): NonNullable<ChildData["weeks"]> {
  const weeks = { ...data?.weeks };
  const current = mondayOf(dateOf(syncedAt));
  if (data?.syncedAt) {
    const previous = mondayOf(dateOf(data.syncedAt));
    for (const monday of [previous, addDays(previous, 7)]) {
      if (monday < current && (!weeks[monday] || weeks[monday].fetchedAt <= data.syncedAt)) weeks[monday] = { lessons: data.lessons.filter((l) => mondayOf(l.date) === monday), fetchedAt: data.syncedAt };
    }
  }
  // These weeks are replaced by authoritative fresh data, so old cancelled lessons cannot linger in the cache.
  delete weeks[current];
  delete weeks[addDays(current, 7)];
  return weeks;
}

export interface DayTimes {
  date: string;
  start: string;
  end: string;
}

export interface UnusualDay {
  date: string;
  /** The day starts or ends off its usual time, or has no lessons. */
  kind: "start" | "end" | "off";
  /** The day's own time and the usual one ("10:15" vs "08:15"); none for a day off. */
  time?: string;
  usual?: string;
  /** Minutes off the usual: positive is later, negative earlier. */
  by?: number;
}

/** Every lesson the app knows for a child: the synced weeks and those read in the Week view. */
export function knownLessons(data: ChildData | undefined): ScheduleLesson[] {
  if (!data) return [];
  const seen = new Set<string>();
  const out: ScheduleLesson[] = [];
  for (const l of [...data.lessons, ...Object.values(data.weeks ?? {}).flatMap((w) => w.lessons)]) {
    const key = `${l.date}|${l.start}|${l.subject}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(l);
    }
  }
  return out;
}

/** Each school day's first start and last end. */
export function dayTimes(lessons: ScheduleLesson[]): Map<string, DayTimes> {
  const days = new Map<string, DayTimes>();
  for (const l of lessons) {
    const d = days.get(l.date);
    if (!d) days.set(l.date, { date: l.date, start: l.start, end: l.end });
    else {
      if (l.start < d.start) d.start = l.start;
      if (l.end > d.end) d.end = l.end;
    }
  }
  return days;
}

function mode(values: string[], tieBreak?: string): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const best = Math.max(0, ...counts.values());
  const top = [...counts].filter(([, n]) => n === best).map(([v]) => v);
  if (!top.length) return null;
  if (top.length === 1 || !tieBreak) return top[0];
  return top.sort((a, b) => Math.abs(minutes(a) - minutes(tieBreak)) - Math.abs(minutes(b) - minutes(tieBreak)))[0];
}

/** The usual start and end for each weekday (0 = Monday). */
export function usualTimes(lessons: ScheduleLesson[]): { byWeekday: Map<number, { start: string; end: string }>; overall: { start: string; end: string } | null } {
  const days = [...dayTimes(lessons).values()];
  const overallStart = mode(days.map((d) => d.start));
  const overallEnd = mode(days.map((d) => d.end));
  const byWeekday = new Map<number, { start: string; end: string }>();
  for (let w = 0; w < 5; w += 1) {
    const same = days.filter((d) => weekday(d.date) === w);
    const start = mode(same.map((d) => d.start), overallStart ?? undefined);
    const end = mode(same.map((d) => d.end), overallEnd ?? undefined);
    if (start && end) byWeekday.set(w, { start, end });
  }
  return { byWeekday, overall: overallStart && overallEnd ? { start: overallStart, end: overallEnd } : null };
}

/** How the given school days (Mon–Fri) differ from the usual: 30 minutes or more either way, or no lessons at all. */
export function unusualDays(data: ChildData | undefined, days: string[]): UnusualDay[] {
  const lessons = knownLessons(data);
  const times = dayTimes(lessons);
  const { byWeekday } = usualTimes(lessons);
  // A week without any lessons isn't known (yet), or is a holiday the messages tell about: not a list of days off.
  const knownWeek = (date: string) => [0, 1, 2, 3, 4].some((i) => times.has(addDays(mondayOf(date), i)));
  const out: UnusualDay[] = [];
  for (const date of days) {
    if (weekday(date) > 4 || !knownWeek(date)) continue;
    const day = times.get(date);
    if (!day) {
      out.push({ date, kind: "off" });
      continue;
    }
    const usual = byWeekday.get(weekday(date));
    if (!usual) continue;
    const start = minutes(day.start) - minutes(usual.start);
    if (Math.abs(start) >= 30) out.push({ date, kind: "start", time: day.start, usual: usual.start, by: start });
    const end = minutes(day.end) - minutes(usual.end);
    if (Math.abs(end) >= 30) out.push({ date, kind: "end", time: day.end, usual: usual.end, by: end });
  }
  return out;
}

/** "1 h 45 min", "40 min" (of the size, either way). */
export function formatMinutes(mins: number): string {
  mins = Math.abs(mins);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

/** One lesson on its day: start and subject (two children's lessons are told apart by the child). */
export const lessonKey = (l: Pick<ScheduleLesson, "start" | "subject">): string => `${l.start}|${l.subject}`;

/** "MA_91" and "MA_" are the same course. */
export const courseOf = (code: string | undefined) => (code ?? "").split("_")[0].trim().toUpperCase() || null;

/** The exam held in this lesson, if Wilma lists one (same day, same subject or course). */
export function examForLesson(data: ChildData | undefined, l: ScheduleLesson): UpcomingExam | null {
  return (data?.exams ?? []).find((e) => e.date === l.date && (e.subjectCode === l.subjectCode || e.subject === l.subject || (courseOf(e.subjectCode) !== null && courseOf(e.subjectCode) === courseOf(l.subjectCode)))) ?? null;
}

/**
 * A subject's name for a course code ("MA_71" → "Matematiikka"), from what
 * the app knows: the timetable, homework and exams. Lesson notes name only
 * the code; an unknown code stays as it is.
 */
export function subjectNamer(data: ChildData | undefined): (code: string) => string {
  const exact = new Map<string, string>();
  const byCourse = new Map<string, string>();
  const add = (code: string | null | undefined, name: string | null | undefined) => {
    if (!code || !name || name === code) return;
    exact.set(code.trim().toUpperCase(), name);
    const course = code.split("_")[0].trim().toUpperCase();
    if (course && !byCourse.has(course)) byCourse.set(course, name);
  };
  for (const l of knownLessons(data)) add(l.subjectCode, l.subject);
  for (const h of data?.overview?.homework ?? []) add(h.subjectCode, h.subject);
  for (const e of data?.exams ?? []) add(e.subjectCode, e.subject);
  return (code: string) => {
    const key = code.trim().toUpperCase();
    if (!/^[A-ZÅÄÖ0-9]+_[A-Z0-9]*$/i.test(code.trim())) return code;
    return exact.get(key) ?? byCourse.get(key.split("_")[0]) ?? code;
  };
}

/** A teacher's code ("KOJ") from the timetable, by name in either order ("Jussi Korhonen" / "Korhonen Jussi"). */
export function teacherCodeFor(data: ChildData | undefined, name: string | null | undefined): string | null {
  if (!name) return null;
  const key = (n: string) => n.toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");
  const wanted = key(name);
  for (const l of knownLessons(data)) {
    if (!l.teacherCode || !l.teacher) continue;
    // A lesson can have several teachers ("Korhonen Jussi, Mäkinen Laura"); codes then come in the same order.
    const names = l.teacher.split(/,\s*/);
    const codes = l.teacherCode.split(/,\s*/);
    const i = names.findIndex((n) => key(n) === wanted);
    if (i >= 0) return codes[i] ?? codes[0] ?? null;
  }
  return null;
}
