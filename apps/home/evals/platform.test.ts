import test from "node:test";
import assert from "node:assert/strict";
import { detectPlatform, isExternalHttpsLink } from "../src/platform.ts";

test("mobile browsers stay web; Tauri targets distinguish phone from desktop", () => {
  assert.equal(detectPlatform(false, "ios", "iPhone"), "web");
  assert.equal(detectPlatform(true, "ios", "Macintosh"), "ios", "iPad desktop user agent still uses the build target");
  assert.equal(detectPlatform(true, "android"), "android");
  assert.equal(detectPlatform(true, "macos"), "desktop");
  assert.equal(detectPlatform(true, "windows"), "desktop");
  assert.equal(detectPlatform(true, "", "iPhone"), "ios");
  assert.equal(detectPlatform(true, "", "Android"), "android");
});

test("native links keep routes in the app and open only external HTTPS destinations", () => {
  const origin = "https://tauri.localhost/";
  for (const href of ["#/inbox/message%3A123", "/", `${origin}#/settings`, "http://school.inschool.fi/", "javascript:void(0)"]) {
    assert.equal(isExternalHttpsLink(href, origin), false, href);
  }
  assert.equal(isExternalHttpsLink("https://school.inschool.fi/", origin), true);
  assert.equal(isExternalHttpsLink("#/inbox", "tauri://localhost/"), false);
  assert.equal(isExternalHttpsLink("https://wilm.ai/", "tauri://localhost/"), true);
});
