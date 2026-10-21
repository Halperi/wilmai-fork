/**
 * Writes WilmAI Home's update feed (apps/site/public/app/latest.json) for a release whose installers are signed for
 * updates: `pnpm home:feed <darwin-aarch64|windows-x86_64>=<file>.sig ...`. Each .sig sits next to the asset it signs,
 * named as uploaded to the release (the Mac's .app.tar.gz, Windows's installer). Notes come from docs/releases/<version>.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseFeeds } from "./home-release";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
const args = process.argv.slice(2).filter((a) => a !== "--");
if (!args.length) throw new Error("Usage: pnpm home:feed darwin-aarch64=<asset>.sig windows-x86_64=<asset>.sig");
const platforms = args.map((arg) => {
  const [platform, sig] = arg.split("=");
  if (!platform || !sig?.endsWith(".sig")) throw new Error(`Not platform=<asset>.sig: ${arg}`);
  return {
    platform,
    signature: readFileSync(sig, "utf8"),
    archive: `https://github.com/aikarjal/wilmai/releases/download/home-v${version}/${basename(sig, ".sig")}`,
  };
});
// The notes' first paragraph after the title: what the app's update notice shows.
const notes = readFileSync(join(root, "docs/releases", `${version}.md`), "utf8").split(/\n\s*\n/)[1]?.replace(/\s+/g, " ").trim() ?? "";
const feed = releaseFeeds({ version, notes, date: new Date().toISOString(), platforms });
const out = join(root, "../../apps/site/public/app/latest.json");
writeFileSync(out, JSON.stringify(feed, null, 2) + "\n");
console.log(`Wrote ${out}: ${version}, ${platforms.map((p) => p.platform).join(", ")}`);
