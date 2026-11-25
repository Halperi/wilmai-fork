import { setNow } from "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { getState } from "../src/data/store.ts";
import { emptySnapshot } from "../src/data/model.ts";
import { notificationTarget } from "../src/data/mobile-notifications.ts";
import { privateNotice, scheduledSchoolNotices, schoolNotices, tomorrowDigest } from "../src/data/school-notifications.ts";

const now = new Date("2026-11-02T12:00:00Z").getTime();
setNow(now);
const account = { baseUrl: "https://synthetic.inschool.fi", username: "synthetic-parent", tenantName: "Synthetic", via: "password" as const };
function fixture() {
  const state = structuredClone(getState());
  state.snapshot = emptySnapshot(account); state.snapshot.syncedAt = new Date(now);
  state.snapshot.children = [{ number: "1", first: "Synthetic Child", name: "Synthetic Child", color: 0 }];
  state.snapshot.perChild["1"] = { syncedAt: new Date(now), lessons: [], notes: [], exams: [], overview: { schedule: [], upcomingExams: [], grades: [], homework: [], fetchedAt: new Date(now) } };
  state.snapshot.messages[1] = { id: 1, subject: "synthetic old message", sender: "Synthetic Teacher", sentAt: new Date(now - 60_000), unreadInWilma: true, replyCount: 0, children: ["1"] };
  state.local = { opened: {}, done: {} }; state.phase = "ready";
  state.settings.aiProvider = "openai"; state.settings.openaiKey = "synthetic-key";
  return state;
}

test("first observation is quiet; later messages, teacher notes and exam marks notify once", () => {
  const state = fixture();
  const first = schoolNotices(state, now); assert.equal(first.notices.length, 0);
  state.local.schoolNotificationLedger = first.ledger;
  state.snapshot!.messages[2] = { ...state.snapshot!.messages[1], id: 2, subject: "synthetic new" };
  state.snapshot!.perChild["1"].notes.push({ date: "2026-11-02", start: "09:00", end: "09:45", subject: "MA", typeLabel: "Selvittämätön poissaolo", typeClass: "absence", teacher: "Synthetic" });
  state.snapshot!.perChild["1"].overview!.grades.push({ examId: 1, date: "2026-10-28", name: "Synthetic Exam", subject: "Mathematics", subjectCode: "MA", grade: "8", verbalGrade: null, info: null, teacher: "Synthetic", teacherCode: "S" });
  const next = schoolNotices(state, now);
  assert.deepEqual(next.notices.map((n) => n.kind).sort(), ["grades", "messages", "notes"]);
  state.local.schoolNotificationLedger = next.ledger;
  assert.equal(schoolNotices(state, now).notices.length, 0);
  state.snapshot!.perChild["1"].overview!.grades[0].grade = "9";
  assert.equal(schoolNotices(state, now).notices[0].kind, "grades");
});

test("new login is baselined independently; disabled categories and old/future notes do not alert", () => {
  const state = fixture(); state.local.schoolNotificationLedger = schoolNotices(state, now).ledger;
  state.settings.schoolNotifications = { messages: false };
  state.snapshot!.messages[2] = { ...state.snapshot!.messages[1], id: 2 };
  assert.equal(schoolNotices(state, now).notices.length, 0);
  const first = schoolNotices(state, now); state.local.schoolNotificationLedger = first.ledger;
  state.settings.schoolNotifications = { messages: true };
  assert.equal(schoolNotices(state, now).notices.length, 0);
  state.snapshot!.perChild["2"] = { syncedAt: new Date(now), lessons: [], notes: [{ date: "2026-11-02", start: null, end: null, subject: "MA", typeLabel: "Late", typeClass: "late", teacher: "S" }], exams: [] };
  state.snapshot!.children.push({ number: "2", first: "Second", name: "Synthetic Second", color: 1 });
  assert.equal(schoolNotices(state, now).notices.length, 0);
});

test("an increase in replies notifies but a reduced count or already opened message does not", () => {
  const state = fixture(); state.local.schoolNotificationLedger = schoolNotices(state, now).ledger;
  state.local.opened["m:1"] = now - 120_000;
  state.snapshot!.messages[1].replyCount = 1;
  assert.equal(schoolNotices(state, now).notices.length, 1);
  state.local.schoolNotificationLedger = schoolNotices(state, now).ledger;
  state.snapshot!.messages[1].replyCount = 0;
  assert.equal(schoolNotices(state, now).notices.length, 0);
  state.snapshot!.messages[1].replyCount = 2; state.local.opened["m:1"] = now;
  assert.equal(schoolNotices(state, now).notices.length, 0);
});

test("scheduled digest uses cached school hours, is one-shot and expires with stale data or AI disabled", () => {
  const state = fixture(); state.settings.schoolNotifications = { digest: true, digestTime: "19:00" };
  state.snapshot!.perChild["1"].lessons.push({ date: "2026-11-03", dayOfWeek: 2, groupId: 1, start: "08:00", end: "08:45", subject: "Mathematics", subjectCode: "MA", teacher: "S", teacherCode: "S", room: "1" });
  const digest = tomorrowDigest(state, "2026-11-03")!;
  assert.ok(digest.lines.some((line) => line.includes("08:00") && line.includes("08:45")));
  const notes = scheduledSchoolNotices(state, now); assert.ok(notes.some((n) => n.id === "digest:2026-11-03"));
  assert.ok(notes.every((n) => n.at > now));
  assert.ok(scheduledSchoolNotices(state, new Date("2026-11-02T20:00:00Z").getTime()).every((n) => n.id !== "digest:2026-11-03"));
  state.snapshot!.syncedAt = new Date(now - 48 * 3_600_000);
  assert.equal(scheduledSchoolNotices(state, now).length, 0);
  state.snapshot!.syncedAt = new Date(now); state.settings.aiProvider = "off";
  assert.equal(scheduledSchoolNotices(state, now).length, 0);
});

test("default notification text and OS targets contain no child, subject, grade or arbitrary route", () => {
  const state = fixture(); state.local.schoolNotificationLedger = schoolNotices(state, now).ledger;
  state.snapshot!.messages[2] = { ...state.snapshot!.messages[1], id: 2, subject: "Sensitive synthetic topic" };
  const n = schoolNotices(state, now).notices[0];
  assert.ok(!JSON.stringify(privateNotice(n, false)).includes("Sensitive"));
  assert.ok(!JSON.stringify(privateNotice(n, false)).includes("Synthetic Child"));
  assert.ok(privateNotice(n, true).body.includes("Sensitive"));
  const scope = "a".repeat(32);
  assert.equal(notificationTarget({ scope, view: "inbox", item: "m:2" }, scope), "m:2");
  assert.equal(notificationTarget({ scope, view: "inbox", item: "m:2" }, "b".repeat(32)), "@wilmas");
  assert.equal(notificationTarget({ scope, view: "https://evil.invalid" }, scope), null);
  assert.equal(notificationTarget({ scope, view: "inbox", item: "javascript:alert(1)" }, scope), "@inbox");
});


test("tomorrow's notification uses the same school hours as the child's card", () => {
  const state = fixture();
  const lessons = state.snapshot!.perChild["1"].lessons;
  const lesson = { date: "2026-11-03", dayOfWeek: 2, start: "08:15", end: "13:00", subject: "Maths", subjectCode: "MA", teacher: "Synthetic Teacher", teacherCode: "T", groupId: 1 };
  // Three usual Tuesdays make tomorrow's optional club a detected schedule change.
  lessons.push(...["2026-10-13", "2026-10-20", "2026-10-27"].map((date) => ({ ...lesson, date })),
    lesson, { ...lesson, start: "13:30", end: "15:00", subject: "Optional club" });
  const unfiltered = tomorrowDigest(state, "2026-11-03")!;
  assert.ok(unfiltered.lines.some((line) => line.includes("08:15–15:00")));
  assert.ok(unfiltered.lines.some((line) => line.includes("School ends 15:00")), "the fixture exercises calendar schedule-change events");
  state.local.leftOut = { "1": ["Optional club"] };
  const digest = tomorrowDigest(state, "2026-11-03")!;
  assert.ok(digest.lines.some((line) => line.includes("08:15–13:00")));
  assert.ok(digest.lines.every((line) => !line.includes("15:00")));
  state.settings.schoolNotifications = { digest: true, digestTime: "19:00" };
  const scheduled = scheduledSchoolNotices(state, now).find((notice) => notice.id === "digest:2026-11-03")!;
  assert.ok(scheduled.body.includes("08:15–13:00"));
  assert.ok(!scheduled.body.includes("15:00"), "the scheduled notification must not contradict its school-hours line");
  assert.equal(lessons.length, 5, "the optional lesson stays in the timetable");
});
