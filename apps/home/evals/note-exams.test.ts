import { setNow } from "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { loadSuite, snapshotOf, at, scoreCase } from "./lib.ts";
import { noteGroups, buildFeed, examsNeedingAttention, forChildren, isNeedsYou } from "../src/data/feed.ts";
import { noteExam } from "../src/data/note-exams.ts";
import { calendarEvents, calendarPanelSource, readExams, type CalEvent } from "../src/data/calendar.ts";
import { DEFAULT_SETTINGS, type LunaRecord } from "../src/data/model.ts";
import { setState, getState } from "../src/data/store.ts";
import { lunaBacklog, runLuna } from "../src/luna/events.ts";
import { overrideBridge } from "../src/wilma/transport.ts";
import type { DecisionQuestion } from "../src/luna/client.ts";
import { retainedScheduleWeeks } from "../src/data/schedule.ts";

const cases = loadSuite(new URL(".", import.meta.url).pathname);
const fixture = () => {
  const c = cases.find((c) => c.id === "note-next-english-exam")!;
  setNow(at(c.today).getTime());
  const snap = snapshotOf(c);
  const child = snap.children[0].number;
  const note = noteGroups(child, snap.perChild[child].notes)[0];
  const record: LunaRecord = { v: "test", hash: "test", at: 0, events: [], dropped: 0, action: null, nextLessonExam: { quote: note.note!, title: "Englannin rästikoe", pRequired: 0.99 } };
  return { c, snap, child, note, record };
};

test("a neutral absence retains the pupil exam, binds the next same-course lesson and original exam, without a guardian task", () => {
  const { c, snap, note, record } = fixture();
  const state = { snapshot: snap, luna: { [note.key]: record }, jev: { [note.key]: { qs: "test", hash: "test", at: 0, model: "test", answers: { tone: { type: "choice" as const, choice: "neutral", confidence: 0.99, probabilities: { neutral: 0.99 } } } } }, local: { opened: {}, done: {} } };
  const checks = scoreCase(c, state).checks;
  assert.deepEqual(checks.filter((c) => !c.ok), []);
  const item = buildFeed(state)[0];
  assert.equal(item.tone, "neutral");
  assert.equal(isNeedsYou(item), false);
});

test("missing or incomplete timetable coverage keeps an unconfirmed instruction instead of guessing", () => {
  const { snap, child, note, record } = fixture();
  snap.perChild[child].lessons = [];
  assert.equal(noteExam(snap, note, record)?.date, null);
  const state = { snapshot: snap, luna: { [note.key]: record }, jev: {}, local: { opened: {}, done: {} } };
  assert.ok(buildFeed(state)[0].pupilExam);
  assert.equal(calendarEvents(snap, buildFeed(state), undefined, { from: "2026-10-09", until: "2026-11-30", children: [] }, state.luna).filter((e) => e.kind === "exam" && e.origin).length, 0);
  snap.perChild[child].weeks = { "2026-10-26": { lessons: [{ date: "2026-10-27", start: "09:00", end: "10:00", dayOfWeek: 2, subject: "Englanti", subjectCode: "ENA1_71", groupId: 1, teacher: "", teacherCode: "" }], fetchedAt: at("2026-10-10") } };
  assert.equal(noteExam(snap, note, record)?.date, null, "a gap before a cached later week makes next unknown");
});

test("home attention includes dated and unconfirmed pupil exams, respects the child filter and clears past or done instructions", () => {
  const { snap, child, note, record } = fixture();
  const state = { snapshot: snap, luna: { [note.key]: record }, jev: {}, local: { opened: {}, done: {} as Record<string, number> } };
  const feed = buildFeed(state);
  assert.equal(examsNeedingAttention(feed).length, 1);
  assert.equal(examsNeedingAttention(forChildren(feed, [snap.children[1].number])).length, 0);
  assert.equal(examsNeedingAttention(forChildren(feed, [child])).length, 1);
  assert.equal(examsNeedingAttention(feed, "2026-10-14").length, 0);
  state.local.done[note.key] = Date.now();
  assert.equal(examsNeedingAttention(buildFeed(state)).length, 0);
  state.local.done = {};
  snap.perChild[child].lessons = [];
  const unknown = examsNeedingAttention(buildFeed(state));
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].pupilExam.date, null);
  assert.equal(isNeedsYou(unknown[0]), false);
});

test("an unconfirmed instruction clears once a later lesson of the subject is over, or two weeks after its note when none is known", () => {
  const { snap, child, note, record } = fixture();
  const lesson = { date: "2026-10-27", start: "09:00", end: "10:00", dayOfWeek: 2, subject: "Englanti", subjectCode: "ENA1_71", groupId: 1, teacher: "", teacherCode: "" };
  snap.perChild[child].lessons = [];
  snap.perChild[child].weeks = { "2026-10-26": { lessons: [lesson], fetchedAt: at("2026-10-10") } };
  const state = { snapshot: snap, luna: { [note.key]: record }, jev: {}, local: { opened: {}, done: {} } };
  const exam = buildFeed(state).find((i) => i.key === note.key)!.pupilExam!;
  assert.deepEqual([exam.date, exam.noLaterThan], [null, "2026-10-27"], "a gap before the week: the exam is on that lesson or before it");
  assert.equal(examsNeedingAttention(buildFeed(state), "2026-10-27").length, 1, "still shown on the lesson's day");
  assert.equal(examsNeedingAttention(buildFeed(state), "2026-10-28").length, 0, "gone once that lesson is past");
  snap.perChild[child].weeks = {};
  assert.equal(examsNeedingAttention(buildFeed(state), "2026-10-23").length, 1, "no later lesson known: shown for two weeks");
  assert.equal(examsNeedingAttention(buildFeed(state), "2026-10-24").length, 0, "then left out");
});

// A private case (it quotes a real school's make-up exam days); without it, the test is skipped.
const makeupNote = cases.find((c) => c.id === "makeup-exam-note");
test("the day panel includes a future note's exam after school even without a matching lesson or Wilma exam entry", { skip: !makeupNote && "the private eval cases aren't here" }, () => {
  const c = makeupNote!;
  setNow(at(c.today).getTime());
  const snap = snapshotOf(c);
  const child = snap.children[0].number;
  const note = noteGroups(child, snap.perChild[child].notes)[0];
  snap.perChild[child].lessons = [{ date: "2026-10-23", start: "12:40", end: "14:20", dayOfWeek: 5, subject: "Yhteiskuntaoppi", subjectCode: "YH_9", groupId: 1, teacher: "Opettaja Esimerkki", teacherCode: "OPE" }];
  const record: LunaRecord = { v: "test", hash: "test", at: 0, events: [{ date: note.date, endDate: null, start: "15:20", end: null, kind: "exam", title: "Fysiikan rästikoe", forWhom: "this_pupil", pupils: [child], quote: note.note!, pDate: 0.99, pCalendar: 0.99 }], action: null, dropped: 0 };
  const state = { snapshot: snap, luna: { [note.key]: record }, jev: {}, local: { opened: {}, done: {} } };
  const feed = buildFeed(state);
  assert.equal(feed.some((i) => i.key === note.key), false, "future notes are absent from the feed but their exams still belong in the day panel");
  const exams = readExams(snap, feed, state.luna, undefined, { from: note.date, until: note.date, children: [child] }, true);
  assert.equal(exams.length, 1);
  assert.equal(exams[0].title, "Fysiikan rästikoe");
  assert.equal(exams[0].start, "15:20");
  assert.equal(exams[0].origin.quote, note.note);
  assert.deepEqual(calendarPanelSource(exams[0]), { kind: "day", child, date: note.date, start: "15:20" });
  assert.equal(readExams(snap, feed, state.luna, undefined, { from: note.date, until: note.date, children: ["another-pupil"] }, true).length, 0);
  record.events[0].pCalendar = 0.65;
  assert.equal(readExams(snap, feed, state.luna, undefined, { from: note.date, until: note.date, children: [child] }).length, 0);
  const suggestion = readExams(snap, feed, state.luna, undefined, { from: note.date, until: note.date, children: [child] }, true)[0];
  assert.equal(suggestion.sure, false);
  assert.equal(readExams(snap, feed, state.luna, { decisions: { [suggestion.key]: "no" }, kinds: {} }, { from: note.date, until: note.date, children: [child] }, true).length, 0);
});

test("calendar exam clicks open the resolved exam day and keep the original note or message link", () => {
  const { snap, child, note, record } = fixture();
  const state = { snapshot: snap, luna: { [note.key]: record }, jev: {}, local: { opened: {}, done: {} } };
  const exam = readExams(snap, buildFeed(state), state.luna, undefined, { from: "2026-10-13", until: "2026-10-13", children: [child] })[0];
  assert.equal(exam.source.kind === "day" && exam.source.date, "2026-10-09", "provenance keeps the original lesson");
  assert.deepEqual(calendarPanelSource(exam), { kind: "day", child, date: "2026-10-13", start: "09:00" });
  assert.equal(exam.origin.key, note.key);
  const message: CalEvent = { ...exam, origin: { key: "m:50", quote: "Rästikoe tiistaina klo 9." }, source: { kind: "item", key: "m:50", line: "Rästikoe tiistaina klo 9." } };
  assert.deepEqual(calendarPanelSource(message), { kind: "day", child, date: "2026-10-13", start: "09:00" });
  const official: CalEvent = { ...exam, origin: undefined, start: "09:20", source: { kind: "day", child, date: "2026-10-13", start: "09:00" } };
  assert.deepEqual(calendarPanelSource(official), official.source, "an official exam keeps its timetable lesson selection");
});

test("same-day double lessons are anchored after all lessons covered by the note", () => {
  const { snap, child, note, record } = fixture();
  const lesson = snap.perChild[child].lessons[0];
  snap.perChild[child].lessons.push({ ...lesson, start: "11:00", end: "11:45" }, { ...lesson, start: "13:00", end: "13:45" });
  note.end = "11:45";
  assert.equal(noteExam(snap, note, record)?.start, "13:00");
});

test("ambiguous original exams or subjects are not guessed, and weak or changed readings are hidden", () => {
  const { snap, child, note, record } = fixture();
  snap.perChild[child].exams.push({ ...snap.perChild[child].exams[0], examId: 7 });
  assert.equal(noteExam(snap, note, record)?.originalExamId, null);
  assert.equal(noteExam(snap, { ...note, subjects: ["ENA1_71", "MA_71"] }, record)?.date, null);
  assert.equal(noteExam(snap, note, { ...record, nextLessonExam: { ...record.nextLessonExam!, pRequired: 0.74 } }), null);
  assert.equal(noteExam(snap, { ...note, note: "Koe peruttu." }, record), null);
});

test("a week rollover preserves the next-lesson anchor and fresh weeks replace stale cancelled lessons", () => {
  const { snap, child, note, record } = fixture();
  const data = snap.perChild[child];
  data.syncedAt = at("2026-10-10");
  data.weeks = { "2026-10-12": { lessons: [{ ...data.lessons[0], date: "2026-10-12" }], fetchedAt: at("2026-10-10") } };
  const newSync = at("2026-10-12");
  data.weeks = retainedScheduleWeeks(data, newSync);
  data.lessons = data.lessons.filter((l) => l.date >= "2026-10-12");
  data.syncedAt = newSync;
  assert.ok(data.weeks["2026-10-05"]);
  assert.equal(data.weeks["2026-10-12"], undefined);
  assert.equal(noteExam(snap, note, record)?.date, "2026-10-13");
});

test("timetable updates move the exam without rereading and Wilma's own next-date exam prevents duplicates", () => {
  const { snap, child, note, record } = fixture();
  setState({ snapshot: snap, settings: { ...DEFAULT_SETTINGS, aiProvider: "openai", openaiKey: "fake" }, luna: {}, jev: {}, usage: {} });
  const h = lunaBacklog().find((x) => x.src.key === note.key)!.h;
  setState({ luna: { [note.key]: { ...record, hash: h } } });
  const lesson = snap.perChild[child].lessons.find((l) => l.date === "2026-10-13")!;
  lesson.date = "2026-10-14";
  setState({ snapshot: snap });
  assert.equal(lunaBacklog().length, 0);
  assert.equal(noteExam(snap, note, record)?.date, "2026-10-14");
  snap.perChild[child].exams.push({ ...snap.perChild[child].exams[0], examId: 8, date: "2026-10-14", time: "09:00" });
  const state = { snapshot: snap, luna: { [note.key]: record }, jev: {}, local: { opened: {}, done: {} } };
  assert.equal(calendarEvents(snap, buildFeed(state), undefined, { from: "2026-10-10", until: "2026-10-20", children: [] }, state.luna).filter((e) => e.kind === "exam").length, 1);
});

test("extraction verifies the pupil instruction and later cancellations remove it from the calendar and feed", async () => {
  const { snap, child, note, record } = fixture();
  snap.messages[50] = { id: 50, subject: "Rästikoe peruttu", sender: "Opettaja Esimerkki", sentAt: at("2026-10-10"), unreadInWilma: false, replyCount: 0, children: [child], thread: { content: "Ainon englannin rästikoe ensi tiistaina on peruttu.", recipients: null, replies: [], collated: false, invite: null, fetchedAt: at("2026-10-10") } };
  setState({ snapshot: snap, settings: { ...DEFAULT_SETTINGS, aiProvider: "openai", openaiKey: "fake", lunaChecks: { crossItem: true } }, luna: {}, jev: {}, local: { opened: {}, done: {} }, usage: {} });
  const requests: string[] = [];
  overrideBridge(async (path, init) => {
    assert.equal(path, "openai");
    const body = init.body as { input: string; questions?: DecisionQuestion[]; text?: { format: { schema: { required: string[] } } } };
    if (init.headers?.["x-openai-path"] === "/v1/responses") {
      const isNote = body.input.includes("Kind: Ennalta anottu vapaa");
      assert.equal(body.text!.format.schema.required.includes("next_lesson_exam"), isNote, "message schema stays unchanged");
      const answer = { action: { quote: null, title: null, deadline: null }, events: [], ...(isNote ? { next_lesson_exam: { quote: record.nextLessonExam!.quote, title: record.nextLessonExam!.title } } : {}) };
      return { status: 200, body: JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] }) };
    }
    const answers = body.questions!.map((q) => {
      requests.push(q.name);
      if (q.type === "predicate") return { type: q.type, name: q.name, probability: 0.99 };
      assert.equal(q.type, "choice");
      return { type: "choice", name: q.name, choice: "cancelled", confidence: 0.99, probabilities: q.choices.map((c) => ({ value: c.value, probability: c.value === "cancelled" ? 0.99 : 0.003 })) };
    });
    return { status: 200, body: JSON.stringify({ answers }) };
  });
  try {
    await runLuna();
    assert.equal(getState().lunaStatus.error, null);
    assert.ok(requests.includes("next_exam_required"));
    assert.ok(requests.some((q) => q.startsWith("about_")), "derived exams participate in cross-item checks");
    assert.equal(buildFeed(getState()).find((i) => i.key === note.key)?.pupilExam, null);
    assert.equal(calendarEvents(snap, buildFeed(getState()), undefined, { from: "2026-10-10", until: "2026-10-20", children: [] }, getState().luna).filter((e) => e.kind === "exam").length, 0);
  } finally { overrideBridge(null); }
});
