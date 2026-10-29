import test from "node:test";
import assert from "node:assert/strict";
import { draftTo, openDraft, readDrafts, saveDraft, writeDrafts } from "../src/data/drafts.ts";

// New-message drafts are the child's, one per recipient: a draft only opens when writing to the person it was written
// to. Before, a child had one draft for whoever came next, and a note's subject was saved as one without a word
// written, so a message to the PE teacher could open with a history note's subject.
const pe = draftTo("/!1001/messages/compose?r_teacher=3005");
const physics = draftTo("/!1001/messages/compose?r_teacher=3001");

test("a compose link is its recipient, wherever Wilma lists them", () => {
  assert.equal(draftTo("/!1001/messages/compose?r_teacher=3001"), "r_teacher=3001");
  assert.equal(draftTo("/!1001/messages/compose?r_teacher=3001&ref=front"), "r_teacher=3001", "only who it's to");
  assert.equal(draftTo("/!1001/messages/compose?r_teacher=2&r_teacher=1"), draftTo("/!1001/messages/compose?r_teacher=1&r_teacher=2"), "a group, in any order");
  assert.notEqual(draftTo("/!1001/messages/compose?r_teacher=3001"), draftTo("/!1001/messages/compose?r_personnel=3001"));
});

test("a draft to one teacher doesn't open for another", () => {
  const drafts = { [physics]: { subject: "Fysiikka to 29.10.: Sinulta puuttui opiskeluvälineitä", text: "Hei, laskin jäi kotiin." } };
  assert.deepEqual(openDraft(drafts, pe, null, false), { words: { subject: "", text: "" }, from: null });
  assert.deepEqual(openDraft(drafts, pe, null, true), { words: { subject: "", text: "" }, from: null }, "not even when no teacher was in mind");
  assert.deepEqual(openDraft(drafts, physics, null, false), { words: drafts[physics], from: physics });
});

test("the old one-draft form: a subject alone is dropped, a message opens only when no teacher was in mind", () => {
  // The leftover from the bug: a note's subject, nothing written.
  assert.deepEqual(readDrafts(JSON.stringify({ subject: "Historia ke 28.10.: Myöhästyminen", text: "" })), {});
  const old = readDrafts(JSON.stringify({ subject: "Retki", text: "Pääseekö Kiia retkelle?" }));
  assert.deepEqual(old, { "": { subject: "Retki", text: "Pääseekö Kiia retkelle?" } });
  assert.deepEqual(openDraft(old, pe, null, true), { words: old[""], from: "" }, "New message, then a teacher picked: as before");
  assert.deepEqual(openDraft(old, pe, null, false), { words: { subject: "", text: "" }, from: null }, "opened for the PE teacher");
});

test("the subject the parent came with: a message to that teacher wins, a subject alone doesn't", () => {
  const note = "Fysiikka to 29.10.: Sinulta puuttui opiskeluvälineitä";
  assert.deepEqual(openDraft({ [physics]: { subject: "Laskin", text: "Hei" } }, physics, note, false).words, { subject: "Laskin", text: "Hei" });
  assert.deepEqual(openDraft({ [physics]: { subject: "Laskin", text: "" } }, physics, note, false), { words: { subject: note, text: "" }, from: null });
  assert.deepEqual(openDraft({ [physics]: { subject: "Laskin", text: "" } }, physics, null, false), { words: { subject: "Laskin", text: "" }, from: physics });
  assert.deepEqual(openDraft({}, physics, note, false), { words: { subject: note, text: "" }, from: null });
});

test("saved words move with the message to whoever it's to now; no words, no draft", () => {
  const words = { subject: "Poissaolo", text: "Kiia on huomenna poissa." };
  const other = { subject: "Laskin", text: "Hei" };
  assert.deepEqual(saveDraft({ [physics]: words }, pe, words, physics), { [pe]: words }, "recipient changed");
  assert.deepEqual(saveDraft({ "": words }, pe, words, ""), { [pe]: words }, "an old draft gets its recipient");
  assert.deepEqual(saveDraft({ [physics]: other }, pe, words, null), { [physics]: other, [pe]: words }, "the other teacher's draft stays");
  assert.deepEqual(saveDraft({ [physics]: other, [pe]: words }, pe, { subject: "", text: "" }, pe), { [physics]: other }, "sent or discarded");
  assert.equal(writeDrafts(saveDraft({ [pe]: words }, pe, { subject: "", text: "" }, pe)), null);
  assert.deepEqual(readDrafts(writeDrafts({ [physics]: other, [pe]: words })), { [physics]: other, [pe]: words });
});

test("whatever is stored, reading it never throws", () => {
  for (const raw of [null, "", "not json", "null", "42", '"text"', "[]", '{"r_teacher=1":{"subject":1}}']) assert.doesNotThrow(() => readDrafts(raw));
  assert.deepEqual(readDrafts('{"r_teacher=1":{"subject":1},"r_teacher=2":{"subject":"a","text":"b"}}'), { "r_teacher=2": { subject: "a", text: "b" } });
});
