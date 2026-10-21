import test from "node:test";
import assert from "node:assert/strict";
import { HOME_FEED, assetName, releaseFeed } from "../scripts/home-release";

test("one installer name per platform, and the Mac build is Apple Silicon only", () => {
  assert.equal(assetName("0.1.0", "macos", "arm64", "dmg"), "WilmAI-Home-0.1.0-beta-macos-arm64.dmg");
  assert.match(assetName("0.1.0", "windows", "x64", "exe"), /-beta-windows-x64\.exe$/);
  assert.match(assetName("0.1.0", "linux", "x64", "AppImage"), /-beta-linux-x64\.AppImage$/);
  assert.throws(() => assetName("0.1.0", "macos", "x64", "dmg"));
  assert.throws(() => assetName("0.1.0-beta.1", "macos", "arm64", "dmg"));
  assert.equal(HOME_FEED, "https://wilm.ai/app/latest.json");
});

test("feed uses a versioned Home asset and carries the signature contents", () => {
  const archive = `https://github.com/aikarjal/wilmai/releases/download/home-v0.1.0/${assetName("0.1.0", "macos", "arm64", "app.tar.gz")}`;
  const input = { version: "0.1.0", platform: "darwin-aarch64", signature: " signed-artifact ", archive, notes: "Beta", date: "2026-10-10T12:00:00Z" };
  const feed = releaseFeed(input);
  assert.equal(feed.platforms["darwin-aarch64"].signature, "signed-artifact");
  assert.equal(feed.platforms["darwin-aarch64"].url, archive);
  assert.throws(() => releaseFeed({ ...input, signature: "" }));
  assert.throws(() => releaseFeed({ ...input, archive: archive.replace("home-v0.1.0", "latest") }));
  assert.throws(() => releaseFeed({ ...input, version: "0.1.1" }));
});
