import { LUNA_THRESHOLDS, lunaEventId, type LunaEvent, type LunaRecord, type Snapshot } from "./model";
import { addDays, dateOf, mondayOf } from "./dates";
import { courseOf, knownLessons } from "./schedule";

export interface PupilExam {
  title: string;
  quote: string;
  date: string | null;
  start: string | null;
  end: string | null;
  /** Only an unambiguous exam of the same pupil, subject and original lesson day. */
  originalExamId: number | null;
}

type ExamNote = { child: string; date: string; start: string | null; end?: string | null; subjects: string[]; note: string | null };
const subjectKey = (s: string) => courseOf(s)?.toLowerCase() ?? s.trim().toLowerCase();
const plain = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Keep the instruction independently of its date. Timetable changes resolve it without another AI read. */
export function noteExam(snap: Snapshot, note: ExamNote, record: LunaRecord | undefined): PupilExam | null {
  const read = record?.nextLessonExam;
  if (!read || read.pRequired < 0.75 || !read.quote.trim() || !plain(note.note ?? "").includes(plain(read.quote))) return null;
  const data = snap.perChild[note.child];
  const subjects = [...new Set(note.subjects.filter(Boolean).map(subjectKey))];
  const matches = (code: string, name: string) => subjects.length === 1 && [subjectKey(code), subjectKey(name)].includes(subjects[0]);
  const original = (data?.exams ?? []).filter((e) => e.date === note.date && matches(e.subjectCode, e.subject));
  const lessons = knownLessons(data).filter((l) => matches(l.subjectCode, l.subject) && (l.date > note.date || (l.date === note.date && note.start !== null && (note.end ? l.start >= note.end : l.start > note.start))))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const candidate = lessons[0];
  // An arbitrary later cached week cannot establish which lesson comes next.
  // Sync reads this and next week; other weeks have explicit cache entries.
  const synced = data?.syncedAt ?? snap.syncedAt;
  const week = synced ? mondayOf(dateOf(synced)) : null;
  const covered = (monday: string) => Boolean(data?.weeks?.[monday]) || (week !== null && (monday === week || monday === addDays(week, 7)));
  let complete = Boolean(candidate);
  if (candidate) for (let m = mondayOf(note.date); m <= mondayOf(candidate.date); m = addDays(m, 7)) if (!covered(m)) complete = false;
  const lesson = complete ? candidate : null;
  return {
    title: read.title,
    quote: read.quote,
    date: lesson?.date ?? null,
    start: lesson?.start ?? null,
    end: lesson?.end ?? null,
    originalExamId: original.length === 1 ? original[0].examId : null,
  };
}

/** A known next lesson is a dated exam; no timetable means no calendar event. */
export function noteExamEvent(snap: Snapshot, note: ExamNote, record: LunaRecord | undefined): LunaEvent | null {
  const exam = noteExam(snap, note, record);
  return exam?.date ? { date: exam.date, endDate: null, start: exam.start, end: exam.end, title: exam.title, kind: "exam", forWhom: "this_pupil", pupils: [note.child], quote: exam.quote, pDate: 1, pCalendar: record!.nextLessonExam!.pRequired } : null;
}

export function examSuperseded(key: string, exam: PupilExam, luna: Record<string, LunaRecord>): boolean {
  if (!exam.date) return false;
  const id = lunaEventId(key, { date: exam.date, title: exam.title });
  return Object.values(luna).some((r) => {
    const link = r.links?.about[id];
    return link && link.cancelled + link.moved >= LUNA_THRESHOLDS.superseded;
  });
}
