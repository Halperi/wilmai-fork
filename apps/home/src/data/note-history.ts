import type { LessonNote } from "@wilma-client/src/core";
import type { ChildData } from "./model";
import { addDays, dateOf } from "./dates";

/** Shared coverage of each routine attendance sync. */
export const noteSyncRange = (day: string) => ({ from: addDays(day, -20), to: addDays(day, 60) });

/** Overlay the sync's authoritative date range on an older whole-year cache. */
export function knownNotes(data: ChildData | undefined): LessonNote[] {
  if (!data?.yearNotes) return data?.notes ?? [];
  const year = data.yearNotes;
  if (!data.syncedAt || new Date(data.syncedAt).getTime() <= new Date(year.fetchedAt).getTime()) return year.notes;
  // Keep the old school year, but not stale/removed versions within the freshly fetched range.
  const day = dateOf(new Date(data.syncedAt));
  const { from, to } = noteSyncRange(day);
  return [...year.notes.filter((note) => note.date < from || note.date > to), ...data.notes];
}
