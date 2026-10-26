import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../src/i18n");
const placeholders = (s: string) => [...s.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort().join(" ");
const marks = (s: string) => `${(s.match(/\*\*/g) ?? []).length}/${(s.replace(/\*\*/g, "").match(/\*/g) ?? []).length}`;

// The Swedish dictionaries are made from the Finnish ones (scripts/translate-ui.ts): the same keys, file for file.
test("Swedish has every entry the Finnish has, with its placeholders and marks", async () => {
  for (const file of readdirSync(dir).filter((f) => /^fi-.*\.ts$/.test(f))) {
    const fi = Object.values(await import(join(dir, file)))[0] as Record<string, string>;
    const sv = Object.values(await import(join(dir, file.replace(/^fi-/, "sv-"))))[0] as Record<string, string>;
    assert.deepEqual(Object.keys(sv).sort(), Object.keys(fi).sort(), `${file}: the same keys`);
    for (const [en, text] of Object.entries(sv)) {
      assert.equal(placeholders(text), placeholders(en), `${file}: placeholders of "${en}"`);
      assert.equal(marks(text), marks(en), `${file}: marks of "${en}"`);
    }
  }
});
