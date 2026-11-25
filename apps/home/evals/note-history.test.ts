import "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import type { LessonNote } from "@wilma-client/src/core";
import type { ChildData } from "../src/data/model.ts";
import { knownNotes } from "../src/data/note-history.ts";

const note = (date: string, typeLabel = "Sinulta puuttui opiskeluvälineitä"): LessonNote => ({
  date, start: "09:00", end: "09:45", subject: "Matematiikka", typeLabel, typeClass: "note", teacher: "Synthetic Teacher",
});
const old = note("2026-09-01", "Synthetic old note");
const removed = note("2026-11-02", "Synthetic removed note");
const current = note("2026-11-03");
const data = (): ChildData => ({
  lessons: [], exams: [], notes: [current], syncedAt: new Date("2026-11-03T10:00:00Z"),
  yearNotes: { notes: [old, removed], fetchedAt: new Date("2026-11-03T08:00:00Z") },
});

test("fresh synced notes appear beside the older school year without reviving removed notes", () => {
  const child = data();
  assert.deepEqual(knownNotes(child), [old, current]);
  assert.deepEqual(child.yearNotes!.notes, [old, removed], "reading the view does not mutate its cache");
});

test("a newer whole-year read wins over stale recent notes, without duplicates", () => {
  const child = data(); child.yearNotes = { notes: [old, current], fetchedAt: new Date("2026-11-03T11:00:00Z") };
  child.notes = [removed];
  assert.deepEqual(knownNotes(child), [old, current]);
  child.notes = [current];
  assert.deepEqual(knownNotes(child), [old, current]);
});

test("recent coverage follows its fetch date; other dates and other children's history stay intact", () => {
  const child = data();
  const future = note("2027-01-15", "Future synthetic note");
  child.yearNotes!.notes.push(future);
  const other: ChildData = { lessons: [], exams: [], notes: [note("2026-11-03", "Other child")] };
  assert.deepEqual(knownNotes(child), [old, future, current]);
  assert.deepEqual(knownNotes(other), other.notes);
  assert.deepEqual(knownNotes(undefined), []);
});
