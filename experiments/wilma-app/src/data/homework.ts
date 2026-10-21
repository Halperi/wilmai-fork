/*
 * Homework, as Wilma gives it: per course, the date it was set and the text.
 * Wilma has no due dates, so "homework for Wednesday" means: for each course
 * on Wednesday's timetable, the latest homework set before Wednesday (within
 * two weeks).
 */
import type { ScheduleLesson } from "@wilma-client/src/core";
import type { HomeworkItem } from "@wilma-client/src/types";
import type { ChildData } from "./model";
import { addDays, daysBetween } from "./dates";
import { noteKind } from "./notes";

/** "MA_91" (homework) and "MA_" (timetable) are the same course: "MA". */
export const courseKey = (code: string) => code.split("_")[0].trim().toUpperCase();

export function sameCourse(lesson: ScheduleLesson, hw: HomeworkItem): boolean {
  const a = courseKey(lesson.subjectCode || "");
  const b = courseKey(hw.subjectCode || "");
  if (a && b) return a === b;
  return Boolean(hw.subject) && lesson.subject.trim().toLowerCase() === hw.subject.trim().toLowerCase();
}

export interface DueHomework {
  lesson: ScheduleLesson;
  item: HomeworkItem;
}

export function homeworkFor(data: ChildData | undefined, date: string): DueHomework[] {
  const all = data?.overview?.homework ?? [];
  const lessons = (data?.lessons ?? []).filter((l) => l.date === date).sort((a, b) => a.start.localeCompare(b.start));
  const out: DueHomework[] = [];
  const seen = new Set<string>();
  for (const lesson of lessons) {
    const course = courseKey(lesson.subjectCode || lesson.subject);
    if (seen.has(course)) continue;
    const item = all
      .filter((hw) => hw.date && hw.date < date && hw.date >= addDays(date, -14) && sameCourse(lesson, hw))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (item) {
      seen.add(course);
      out.push({ lesson, item });
    }
  }
  return out;
}

/** The homework for one lesson: the latest set for its course before (or on) its day, within two weeks. */
export function homeworkForLesson(data: ChildData | undefined, lesson: ScheduleLesson): HomeworkItem | null {
  return (
    (data?.overview?.homework ?? [])
      .filter((hw) => hw.date && hw.date <= lesson.date && hw.date >= addDays(lesson.date, -14) && sameCourse(lesson, hw))
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
  );
}

export function recentHomework(data: ChildData | undefined, now: string, days = 7): HomeworkItem[] {
  return (data?.overview?.homework ?? [])
    .filter((hw) => hw.date && daysBetween(hw.date, now) <= days && hw.date <= now)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Homework by the lesson it's due: each item once, on its course's first
 * lesson after the day it was set, when that lesson is one of `days`. Items
 * set more than three days before the first of `days` are left out: their
 * due lesson may have been earlier still, which isn't known here.
 */
export function dueHomework(data: ChildData | undefined, lessons: ScheduleLesson[], days: string[]): DueHomework[] {
  if (!days.length) return [];
  const ordered = [...lessons].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const first = [...days].sort()[0];
  const seen = new Set<string>();
  const out: DueHomework[] = [];
  for (const item of data?.overview?.homework ?? []) {
    if (!item.date || item.date < addDays(first, -3)) continue;
    // "Ei läksyä." with instructions only for pupils who were away isn't homework for a child who was there.
    if (!isForChild(data, item)) continue;
    const lesson = ordered.find((l) => l.date > item.date && sameCourse(l, item));
    const key = `${lesson?.date}|${item.subject}|${item.homework}`;
    if (!lesson || !days.includes(lesson.date) || seen.has(key)) continue;
    seen.add(key);
    out.push({ lesson, item });
  }
  return out.sort((a, b) => (a.lesson.date + a.lesson.start).localeCompare(b.lesson.date + b.lesson.start));
}

/**
 * Teachers often add instructions for pupils who missed the lesson
 * ("POISSAOLIJAT 1. Lue …"), sometimes most of the text. Split them off,
 * so the list can show what the class has to do and fold the rest.
 */
export function splitAbsentees(text: string): { main: string; absentees: string | null } {
  const m = /\b(poissaolijat|poissaolleet|poissa olleet|poissaolijoille|poissa olleille|poissaoleville|tunnilta poissa olleet|frånvarande)\b/i.exec(text);
  if (!m) return { main: text, absentees: null };
  return { main: text.slice(0, m.index).replace(/[\s.,;:–-]+$/, "").trim(), absentees: text.slice(m.index).trim() };
}

/** Whether the child was away from the lesson a homework was given in (an absence note that day for that course). */
export function absentWhenGiven(data: ChildData | undefined, item: HomeworkItem): boolean {
  const notes = data?.yearNotes?.notes ?? data?.notes ?? [];
  const course = courseKey(item.subjectCode || item.subject);
  return notes.some((n) => n.date === item.date && courseKey(n.subject || "") === course && ["absence", "explain"].includes(noteKind(n)));
}

/** "Ei läksyä." / "No homework": the class has nothing to do (instructions for pupils who were away may follow). */
// (No \\b after "ä": JavaScript's word boundary only knows a–z.)
export const saysNoHomework = (text: string): boolean => /^\s*(ei (läksyä|läksyjä|kotitehtävää|kotitehtäviä)|no homework|ingen läxa)(?=[\s.,;:!]|$)/i.test(text);

/** Whether a homework item is something this child has to do: not "no homework", unless they were away and instructions follow. */
export function isForChild(data: ChildData | undefined, item: HomeworkItem): boolean {
  const { main, absentees } = splitAbsentees(item.homework);
  if (!saysNoHomework(main || item.homework)) return true;
  return Boolean(absentees) && absentWhenGiven(data, item);
}
