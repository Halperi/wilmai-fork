import test from "node:test";
import assert from "node:assert/strict";
import { BackSwipe } from "../src/ui/swipe-back.ts";

test("a deliberate rightward swipe navigates back once it travels far enough", () => {
  const swipe = new BackSwipe(12, 200, 0);
  assert.equal(swipe.move(18, 202, 15), false);
  assert.equal(swipe.move(40, 204, 40), true);
  assert.equal(swipe.finish(110, 210, 250), true);
});

test("vertical scrolling never turns into a back gesture later", () => {
  const swipe = new BackSwipe(10, 200, 0);
  assert.equal(swipe.move(15, 225, 40), false);
  assert.equal(swipe.finish(160, 205, 250), false);
});

test("short drags, leftward movement, diagonal scrolling and long presses do not go back", () => {
  assert.equal(new BackSwipe(10, 200, 0).finish(60, 200, 200), false);
  assert.equal(new BackSwipe(100, 200, 0).finish(10, 200, 200), false);
  assert.equal(new BackSwipe(10, 200, 0).finish(100, 300, 200), false);
  assert.equal(new BackSwipe(10, 200, 0).finish(100, 200, 1600), false);
  const reversed = new BackSwipe(20, 200, 0);
  reversed.move(5, 200, 30);
  assert.equal(reversed.finish(180, 200, 200), false);
});
