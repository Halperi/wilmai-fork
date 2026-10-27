import "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import type { Message } from "@wilma-client/src/core";
import { writtenByFamily, type LunaRecord, type MessageRec } from "../src/data/model.ts";
import { buildFeed, isNeedsYou, type FeedItem } from "../src/data/feed.ts";
import { withSent } from "../src/data/engine.ts";
import { demoSnapshot } from "../src/demo/demo.ts";
import { lunaSources } from "../src/luna/events.ts";
import { jevBacklog } from "../src/jev/runner.ts";
import { setState } from "../src/data/store.ts";
import { calendarEvents } from "../src/data/calendar.ts";
import { addDays, today } from "../src/data/dates.ts";

// Messages the family wrote (to a teacher): in Wilma's Sent folder until someone answers, then in the inbox too. They
// show in the inbox either way, and they're never a step for the family.
const children = [{ name: "Aino Esimerkki" }, { name: "Veeti Esimerkki" }];

test("a guardian of one of the children, or the pupil themself, is the family", () => {
  assert.equal(writtenByFamily("Esimerkki Sanna (Aino Esimerkki, 9C)", children), true);
  assert.equal(writtenByFamily("Esimerkki Jari (Veeti Esimerkki, 7G)", children), true, "the other guardian");
  assert.equal(writtenByFamily("Esimerkki Aino (9C)", children), true, "the pupil on their own login");
  assert.equal(writtenByFamily("Esimerkki Aino", children), true);
});

test("teachers and other families' parents aren't", () => {
  assert.equal(writtenByFamily("Korhonen Jussi (KOJ)", children), false);
  assert.equal(writtenByFamily("Virtanen Matti (Liisa Virtanen, 9C)", children), false, "another family's parent");
  assert.equal(writtenByFamily("Rehtori", children), false);
  assert.equal(writtenByFamily(null, children), false);
  assert.equal(writtenByFamily("Esimerkki Sanna (Aino Esimerkki, 9C)", []), false);
});

test("the family's own message never needs them, whatever the reading says", () => {
  const triage = { needsAction: 0.95, scope: "pupil", detail: null } as unknown as FeedItem["triage"];
  const item = { done: false, task: null, triage, at: new Date(), dated: false, upcoming: [], deadline: null, eventDate: null } as unknown as FeedItem;
  assert.equal(isNeedsYou(item), true);
  assert.equal(isNeedsYou({ ...item, own: true }), false);
});

const listed = (wilmaId: number, replyCount = 0): Message => ({ wilmaId, subject: `Viesti ${wilmaId}`, sentAt: new Date("2026-10-26T17:00:00Z"), folder: "outbox", senderName: "Korhonen Jussi (KOJ)", replyCount, fetchedAt: new Date() });
const rec = (id: number, extra: Partial<MessageRec> = {}): MessageRec => ({ id, subject: `Viesti ${id}`, sender: "Esimerkki Sanna (Aino Esimerkki, 9C)", sentAt: new Date("2026-10-26T17:00:00Z"), unreadInWilma: false, replyCount: 1, children: ["1"], ...extra });
const thread = { content: "Hei", recipients: ["Korhonen Jussi (KOJ)"], replies: [], collated: false, fetchedAt: new Date() };

test("what the Sent folder lists is the family's, unless the inbox has the thread (answered)", () => {
  const merged = withSent({ 5: rec(5) }, {}, [["1", [listed(5, 1), listed(6)]], ["2", [listed(6)]]]);
  assert.equal(merged[5].sent, undefined, "the inbox's listing wins");
  assert.equal(merged[5].sender, "Esimerkki Sanna (Aino Esimerkki, 9C)");
  assert.equal(merged[6].sent, true);
  assert.equal(merged[6].sender, null, "who the Sent folder names isn't the sender");
  assert.deepEqual(merged[6].children, ["1", "2"]);
  assert.equal(merged[6].unreadInWilma, false);
});

test("a sent message keeps its thread until an answer comes", () => {
  const before = { 6: rec(6, { sender: null, sent: true, replyCount: 0, thread }) };
  assert.equal(withSent({}, before, [["1", [listed(6)]]])[6].thread, thread);
  assert.equal(withSent({}, before, [["1", [listed(6, 1)]]])[6].thread, undefined, "an answer means reading it again");
});

test("an unanswered sent message shows in the inbox as the family's, to whom, not new and never a step", () => {
  const snapshot = demoSnapshot();
  const sent = Object.values(snapshot.messages).find((m) => m.sent)!;
  const key = `m:${sent.id}`;
  const triage = { needsAction: 0.95, scope: "pupil", detail: null } as unknown as FeedItem["triage"];
  const item = buildFeed({ snapshot, local: { opened: {}, done: {} }, jev: {}, luna: {} }).find((i) => i.key === key)!;
  assert.equal(item.own, true);
  assert.equal(item.isNew, false, "what the family just sent isn't news to them");
  assert.equal(item.from, "To Korhonen Jussi (KOJ), no reply yet");
  assert.equal(isNeedsYou({ ...item, triage }), false);
  const unread = { ...snapshot, messages: { ...snapshot.messages, [sent.id]: { ...sent, thread: undefined } } };
  assert.equal(buildFeed({ snapshot: unread, local: { opened: {}, done: {} }, jev: {}, luna: {} }).find((i) => i.key === key)!.from, "Sent by you, no reply yet");
});

test("the AI doesn't read the family's unanswered message", () => {
  const snapshot = demoSnapshot();
  const sent = Object.values(snapshot.messages).find((m) => m.sent)!;
  assert.ok(!lunaSources(snapshot, "guardian").some((s) => s.key === `m:${sent.id}`));
  setState({ snapshot });
  assert.ok(!jevBacklog().new.includes(`m:${sent.id}`));
  assert.ok(jevBacklog().new.length > 0, "the school's messages are still read");
});

test("an earlier AI reading of the family's unanswered message doesn't show, nor its dates", () => {
  const snapshot = demoSnapshot();
  const sent = Object.values(snapshot.messages).find((m) => m.sent)!;
  const key = `m:${sent.id}`;
  const date = addDays(today(), 2);
  const event = { date, endDate: null, start: "11:00", end: null, title: "Hammaslääkäri", kind: "event", forWhom: "this_pupil", quote: "torstaiaamuna", pDate: 0.99, pCalendar: 0.99 };
  const luna = { [key]: { v: "1", hash: "earlier", at: 0, events: [event] } as unknown as LunaRecord };
  const state = { snapshot, local: { opened: {}, done: {} }, jev: {}, luna };
  const item = buildFeed(state).find((i) => i.key === key)!;
  assert.equal(item.triage, null);
  assert.deepEqual(item.upcoming, []);
  const events = calendarEvents(snapshot, buildFeed(state), undefined, { from: today(), until: addDays(today(), 7), children: [] }, luna);
  assert.ok(!events.some((e) => e.title === "Hammaslääkäri"));
});
