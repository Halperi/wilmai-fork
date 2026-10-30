import { setNow } from "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import type { JevRecord, LunaEvent, LunaRecord } from "../src/data/model.ts";
import { agenda, buildFeed, isNeedsYou, needsYou } from "../src/data/feed.ts";
import { TRIAGE_QS } from "../src/jev/questions.ts";
import { demoSnapshot } from "../src/demo/demo.ts";
import { urgencyLabel } from "../src/ui/shared.ts";

// A school day that ends earlier (or starts later, or has no lessons), said in passing in a message with nothing to do:
// the parent has to know (a first-grader is picked up earlier), so it's under Needs you in the week before the day, and
// the day itself shows what changes rather than the message's subject. As a real one was read: right, but not shown.
setNow(new Date("2026-10-29T18:00:00+02:00").getTime()); // Thursday evening

const SHORTER = "Siksi huominen koulupäivä on vastaavasti 30 minuuttia lyhyempi.";
const ASK = "Kysykää kotona, mikä nuorta jäi esityksessä mietityttämään.";

function stateWith(change: Partial<LunaEvent> = {}, needsAction = 0) {
  const snapshot = demoSnapshot();
  const message = Object.values(snapshot.messages).find((m) => !m.sent)!;
  const key = `m:${message.id}`;
  const choice = (c: string, confidence: number, probabilities: Record<string, number> = {}) => ({ type: "choice" as const, choice: c, confidence, probabilities });
  const jev: Record<string, JevRecord> = {
    [key]: {
      qs: TRIAGE_QS,
      hash: "h",
      model: "test",
      at: 0,
      answers: { needs_action: { type: "noul", noul: needsAction }, kind: choice("schedule", 0.95), scope: choice("group", 0.35, { pupil: 0.1 }), praise: { type: "noul", noul: 0.5 } },
    },
  };
  const event: LunaEvent = { date: "2026-10-30", endDate: null, start: null, end: null, title: "Lyhennetty koulupäivä", kind: "schedule", forWhom: "pupils_class", quote: SHORTER, pDate: 1, pCalendar: 1, pOptional: 0, ...change };
  const luna: Record<string, LunaRecord> = { [key]: { v: "1", hash: "h", at: 0, action: { quote: ASK, deadline: null, pRequired: 0 }, events: [event], dropped: 0 } };
  const state = { snapshot, local: { opened: {}, done: {} }, jev, luna };
  const item = buildFeed(state).find((i) => i.key === key)!;
  return { snapshot, state, item, child: message.children[0] };
}

test("tomorrow's shorter school day needs the parent, with the sentence saying so", () => {
  const { item } = stateWith();
  assert.equal(item.change?.title, "Lyhennetty koulupäivä");
  assert.equal(isNeedsYou(item), true);
  assert.equal(item.actionLine, SHORTER, "not the optional invitation to talk about it at home");
  assert.equal(urgencyLabel(item), "Tomorrow");
});

test("the day shows what changes, not the message's subject, once", () => {
  const { snapshot, item, child } = stateWith();
  const days = agenda(snapshot, [item], [child], { from: "2026-10-29", until: "2026-10-30" });
  assert.deepEqual(
    days.map((e) => [e.date, e.kind, e.title, e.detail]),
    [["2026-10-30", "schedule", "Lyhennetty koulupäivä", item.title]]
  );
});

test("a change later in the week is named by its day; one further off waits until the week before", () => {
  const near = stateWith({ date: "2026-11-04" }).item;
  assert.equal(isNeedsYou(near), true);
  assert.equal(urgencyLabel(near), "Wednesday", "the day itself, not \"By Wednesday\"");
  const far = stateWith({ date: "2026-11-12" }).item;
  assert.equal(isNeedsYou(far), false);
  assert.ok(far.change, "still in the calendar and This week and next");
});

test("not when it's over, unsure, for someone else, or only for those who choose to join", () => {
  assert.equal(isNeedsYou(stateWith({ date: "2026-10-28" }).item), false);
  assert.equal(isNeedsYou(stateWith({ pCalendar: 0.5 }).item), false);
  assert.equal(isNeedsYou(stateWith({ pupils: [] }).item), false);
  assert.equal(isNeedsYou(stateWith({ pOptional: 0.8 }).item), false);
});

test("a required step keeps its own sentence; Done takes the change away", () => {
  const { state, item } = stateWith({}, 0.9);
  assert.equal(item.actionLine, ASK);
  assert.equal(needsYou(buildFeed({ ...state, local: { opened: {}, done: { [item.key]: Date.now() } } })).length, needsYou(buildFeed(state)).length - 1);
});
