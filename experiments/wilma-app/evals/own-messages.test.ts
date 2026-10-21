import "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { writtenByFamily } from "../src/data/model.ts";
import { isNeedsYou, type FeedItem } from "../src/data/feed.ts";

// Messages the family wrote (to a teacher) show up in the inbox once someone answers; they're never a step for the family.
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
