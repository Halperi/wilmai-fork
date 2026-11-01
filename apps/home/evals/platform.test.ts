import test from "node:test";
import assert from "node:assert/strict";
import { detectPlatform } from "../src/platform.ts";

test("mobile browsers stay web; Tauri targets distinguish phone from desktop", () => {
  assert.equal(detectPlatform(false, "ios", "iPhone"), "web");
  assert.equal(detectPlatform(true, "ios", "Macintosh"), "ios", "iPad desktop user agent still uses the build target");
  assert.equal(detectPlatform(true, "android"), "android");
  assert.equal(detectPlatform(true, "macos"), "desktop");
  assert.equal(detectPlatform(true, "windows"), "desktop");
  assert.equal(detectPlatform(true, "", "iPhone"), "ios");
  assert.equal(detectPlatform(true, "", "Android"), "android");
});
