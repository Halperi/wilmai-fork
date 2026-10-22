/**
 * How many people get and use WilmAI Home, from counts that exist anyway; nothing in the app tracks anyone:
 * - GitHub's download counts for every Home release: the installers, and the Mac update archive, which only an
 *   installed app downloads when it updates itself (on Windows, the app updates with the installer);
 * - on wilm.ai (Cloudflare's request analytics, read with the `cf` CLI): front page and Home page views, and the update checks
 *   every installed app makes (at start, then every 6 hours), so about four a day for each app that's running.
 *   These are counts per day; no address or anything else about a person is read.
 */
import { execFileSync } from "node:child_process";

type Release = { tag_name: string; assets: { name: string; download_count: number }[] };
const pages = JSON.parse(execFileSync("gh", ["api", "--paginate", "--slurp", "repos/aikarjal/wilmai/releases?per_page=100"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })) as Release[][];
const releases = pages.flat().filter((release) => release.tag_name.startsWith("home-v")).reverse();
const count = (release: Release, file: RegExp) => release.assets.filter((asset) => file.test(asset.name)).reduce((sum, asset) => sum + asset.download_count, 0);
const rows = releases.map((release) => ({
  release: release.tag_name.slice("home-v".length),
  "Mac installer": count(release, /-macos-[^.]+\.dmg$/),
  "Windows installer": count(release, /-windows-[^.]+\.exe$/),
  "Mac updates": count(release, /-macos-[^.]+\.app\.tar\.gz$/),
}));
const total = (column: Exclude<keyof (typeof rows)[number], "release">) => rows.reduce((sum, row) => sum + row[column], 0);
console.log("Downloads from GitHub, per Home release:");
console.table([...rows, { release: "all", "Mac installer": total("Mac installer"), "Windows installer": total("Windows installer"), "Mac updates": total("Mac updates") }]);
console.log("Repeated downloads count again, and GitHub doesn't say who downloaded. Windows installer downloads include the apps that updated themselves; a replaced file's count starts again from zero.\n");

// wilm.ai's account on Cloudflare (apps/site/wrangler.jsonc).
const ACCOUNT = "055d00c523a88d6e0c0f4056c9fc1d75";
const DAYS = 14;
const query = `SELECT toDate(timestamp) AS day,
  countIf(clientRequestPath IN ('/en', '/fi') AND edgeResponseStatus = 200) AS frontViews,
  countIf(clientRequestPath IN ('/en/home', '/fi/home') AND edgeResponseStatus = 200) AS pageViews,
  countIf(clientRequestPath = '/app/latest.json' AND userAgent LIKE 'tauri-plugin-updater/%') AS appChecks,
  countIf(clientRequestPath = '/app/latest.json' AND userAgent LIKE 'WilmAI-Home/%') AS otherChecks
FROM events.httpRequests
WHERE clientRequestHttpHost = 'wilm.ai' AND timestamp > now() - INTERVAL ${DAYS} DAY
GROUP BY day ORDER BY day LIMIT 100 FORMAT JSON`.replace(/\s+/g, " ");
try {
  const out = execFileSync("cf", ["analytics", "sql", "post", "--scope-account-tag", ACCOUNT, "--query", query], {
    encoding: "utf8",
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const rows = (JSON.parse(out.slice(out.indexOf("{"))) as { data?: Record<string, string>[]; result?: { data?: Record<string, string>[] } });
  const data = rows.data ?? rows.result?.data ?? [];
  console.log(`On wilm.ai, the last ${DAYS} days (Cloudflare, counts only):`);
  console.table(data.map((r) => ({
    day: r.day,
    "front page views": Number(r.frontViews),
    "Home page views": Number(r.pageViews),
    "update checks": Number(r.appChecks),
    "≈ apps running": Math.round(Number(r.appChecks) / 4),
    "older builds' checks": Number(r.otherChecks),
  })));
  console.log("A running app checks for updates at start and every 6 hours, about four times a day. Older and development builds check with their own name.");
} catch (err) {
  console.log(`wilm.ai's numbers need the cf CLI, signed in to Cloudflare (${err instanceof Error ? err.message.split("\n")[0] : String(err)}).`);
}
