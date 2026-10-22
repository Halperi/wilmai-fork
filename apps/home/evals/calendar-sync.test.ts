import { setNow } from "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { at, snapshotOf, type Case } from "./lib.ts";
import { buildFeed } from "../src/data/feed.ts";
import { calendarEvents, type CalEvent } from "../src/data/calendar.ts";
import { reconcile, syncEntry, syncWindow, wantedEntries, type StoredEntry, type SyncEntry } from "../src/data/calendar-sync.ts";
import type { CalendarLocal, LunaEvent, LunaRecord } from "../src/data/model.ts";
import { getState, setCalendarDecision, setState } from "../src/data/store.ts";

// A made-up family: a parents' evening both children's teachers wrote about, a bulletin with two exams on one day, and
// two exams in Wilma's own list that came without ids.
const TODAY = "2026-10-21";
const family: Case = {
  id: "calendar-sync",
  added: TODAY,
  why: "the calendar's keys and the sync's plan",
  today: TODAY,
  pupils: [
    { name: "Aino Esimerkki", class: "9C" },
    { name: "Veeti Esimerkki", class: "7G" },
  ],
  items: [
    { type: "message", id: 101, sent: "2026-10-10T15:00", from: "Opettaja Yksi", subject: "Vanhempainilta", text: "Tervetuloa vanhempainiltaan to 5.11. klo 18.", pupils: [0] },
    { type: "message", id: 102, sent: "2026-10-15T15:00", from: "Opettaja Kaksi", subject: "Muistutus", text: "Muistathan vanhempainillan to 5.11. klo 18.", pupils: [1] },
    { type: "news", id: 201, published: "2026-10-12T09:00", from: "Rehtori", title: "Kokeet", text: "Ti 3.11. kemian koe ja fysiikan koe.", pupils: [0] },
    { type: "exam", id: 0, pupil: 0, date: "2026-11-10", subject: "Historia", subjectCode: "HI3_9C", teacher: "Opettaja Kolme", teacherCode: "OKO" },
    { type: "exam", id: 0, pupil: 0, date: "2026-11-10", subject: "Biologia", subjectCode: "BI3_9C", teacher: "Opettaja Neljä", teacherCode: "ONE" },
  ],
  expect: {},
};

const event = (e: Partial<LunaEvent> & Pick<LunaEvent, "date" | "title" | "quote">): LunaEvent => ({ endDate: null, start: null, end: null, kind: "event", forWhom: "this_pupil", pDate: 0.95, pCalendar: 0.95, ...e });
const record = (events: LunaEvent[]): LunaRecord => ({ v: "test", hash: "test", at: 0, events, dropped: 0, action: null });

function setup(shuffle = false) {
  setNow(at(TODAY).getTime());
  const snap = snapshotOf(family);
  const [aino, veeti] = snap.children.map((c) => c.number);
  const items = buildFeed({ snapshot: snap, local: { opened: {}, done: {} }, jev: {}, luna: {} });
  const first = items.find((i) => i.title === "Vanhempainilta")!.key;
  const second = items.find((i) => i.title === "Muistutus")!.key;
  const bulletin = items.find((i) => i.title === "Kokeet")!.key;
  const exams = [
    event({ date: "2026-11-03", title: "Kemian koe", kind: "exam", quote: "kemian koe", pupils: [aino] }),
    event({ date: "2026-11-03", title: "Fysiikan koe", kind: "exam", quote: "fysiikan koe", pupils: [aino] }),
  ];
  const luna: Record<string, LunaRecord> = {
    // Only fairly sure it's this family's: a suggestion.
    [first]: record([event({ date: "2026-11-05", start: "18:00", title: "Vanhempainilta", quote: "vanhempainiltaan to 5.11. klo 18", pupils: [aino], pCalendar: 0.6 })]),
    [second]: record([event({ date: "2026-11-05", start: "18:00", title: "Vanhempainilta", quote: "vanhempainillan to 5.11. klo 18", pupils: [veeti] })]),
    [bulletin]: record(shuffle ? [...exams].reverse() : exams),
  };
  const state = { snapshot: snap, local: { opened: {}, done: {} } as { opened: Record<string, number>; done: Record<string, number>; calendar?: CalendarLocal }, jev: {}, luna };
  const feed = buildFeed(state);
  const events = (local?: CalendarLocal) => calendarEvents(snap, shuffle ? [...feed].reverse() : feed, local, { ...syncWindow(TODAY), children: [] }, luna);
  return { snap, aino, veeti, first, second, bulletin, state, events };
}

const evening = (list: CalEvent[]) => list.find((e) => e.title === "Vanhempainilta")!;

test("an event's key doesn't depend on the order things were read in", () => {
  const keys = (list: CalEvent[]) => list.map((e) => e.key).sort();
  assert.deepEqual(keys(setup(true).events()), keys(setup().events()));
  const exams = setup().events().filter((e) => e.date === "2026-11-03");
  assert.equal(exams.length, 2);
  assert.ok(exams.every((e) => e.key.includes("~")), "two exams one bulletin gives for one day are told apart by title, both");
});

test("Wilma's exams without an id each have a key of their own", () => {
  const exams = setup().events().filter((e) => e.date === "2026-11-10");
  assert.equal(exams.length, 2);
  assert.notEqual(exams[0].key, exams[1].key);
  assert.ok(exams.every((e) => !e.key.endsWith(":0")));
});

test("the same event from two messages is one: the older message's key, for both children, sure if either is", () => {
  const { first, second, aino, veeti, events } = setup();
  const e = evening(events());
  assert.ok(e.key.startsWith(`${first}:`));
  assert.deepEqual(e.children, [aino, veeti]);
  assert.equal(e.sure, true, "the second message is sure, so the event is");
  assert.ok(e.aliases?.some((k) => k.startsWith(`${second}:`)));
});

test("the parent's word on either source's key counts, and a dismissal wins", () => {
  const { events } = setup();
  const e = evening(events());
  const alias = e.aliases![0];
  assert.equal(evening(events({ decisions: { [alias]: "no" }, kinds: {} })), undefined, "dismissed through the other message's key");
  assert.equal(evening(events({ decisions: { [e.key]: "yes", [alias]: "no" }, kinds: {} })), undefined);

  setState({ local: { opened: {}, done: {}, calendar: { decisions: { [alias]: "no" }, kinds: {} } } });
  setCalendarDecision(e, "yes");
  assert.deepEqual(getState().local.calendar?.decisions, { [e.key]: "yes" }, "a new word replaces the one on the other key");
  setCalendarDecision(e, null);
  assert.deepEqual(getState().local.calendar?.decisions, {});
});

test("what goes to the calendar: sure events of the kinds that are on, titled whose they are", () => {
  const { state, snap } = setup();
  const wanted = wantedEntries(state, syncWindow(TODAY));
  assert.deepEqual(wanted.map((w) => w.title).sort(), ["Aino, Veeti: Vanhempainilta", "Aino: Biologia", "Aino: Fysiikan koe", "Aino: Historia", "Aino: Kemian koe"]);
  const e = wanted.find((w) => w.title.endsWith("Vanhempainilta"))!;
  assert.equal(e.start, "18:00");
  assert.match(e.description, /WilmAI Home/);
  state.local.calendar = { decisions: {}, kinds: { exam: false } };
  assert.deepEqual(wantedEntries(state, syncWindow(TODAY)).map((w) => w.title), ["Aino, Veeti: Vanhempainilta"]);

  const holiday: CalEvent = { key: "h", kind: "holiday", children: snap.children.map((c) => c.number), title: "Syysloma", date: "2026-10-19", endDate: "2026-10-23", start: null, end: null, detail: null, itemKey: null, source: { kind: "item", key: "x", line: null }, sure: true };
  assert.equal(syncEntry(holiday, snap.children).title, "Syysloma", "a holiday for every child is just the holiday");
  assert.notEqual(syncEntry({ ...holiday, endDate: "2026-10-25" }, snap.children).hash, syncEntry(holiday, snap.children).hash);
});

test("the sync's plan: add, change what the school changed, remove from today on, and a deletion there is a dismissal", () => {
  const entry = (key: string, date: string, hash = key): SyncEntry => ({ key, title: key, description: "", date, endDate: null, start: null, end: null, hash });
  const stored = (key: string, date: string, more: Partial<StoredEntry> = {}): StoredEntry => ({ key, hash: key, date, ...more });
  const window = { ...syncWindow(TODAY), complete: true };
  const wanted = [entry("new", "2026-11-01"), entry("same", "2026-11-02"), entry("moved", "2026-11-04", "moved2"), entry("deleted-there", "2026-11-05")];
  const there = [
    stored("same", "2026-11-02"),
    stored("moved", "2026-11-03"),
    stored("deleted-there", "2026-11-05", { cancelled: true }),
    stored("gone", "2026-11-06"),
    stored("past", "2026-10-01"),
    stored("far", "2027-06-01"),
  ];
  const plan = reconcile(wanted, there, window);
  assert.deepEqual(plan.add.map((e) => e.key), ["new"]);
  assert.deepEqual(plan.change.map((e) => e.key), ["moved"]);
  assert.deepEqual(plan.remove, ["gone"], "what's past or beyond the window stays as it was");
  assert.deepEqual(plan.dismissed, ["deleted-there"]);
  assert.deepEqual(reconcile(wanted, there, { ...window, complete: false }).remove, [], "nothing is removed when Wilma wasn't read whole");
});
