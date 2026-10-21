/**
 * How many people get and use WilmAI Home, from counts that exist anyway; nothing in the app tracks anyone:
 * - GitHub's download count for each installer in the release;
 * - on wilm.ai (Cloudflare's request analytics, read with the `cf` CLI): Home page views, and the update checks
 *   every installed app makes (at start, then every 6 hours), so about four a day for each app that's running.
 *   These are counts per day; no address or anything else about a person is read.
 */
import { execFileSync } from "node:child_process";
import { version } from "../package.json";

const release = JSON.parse(execFileSync("gh", ["api", `repos/aikarjal/wilmai/releases/tags/home-v${version}`], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })) as { assets: { name: string; download_count: number }[] };
const installers = release.assets.filter((asset) => asset.name.startsWith(`WilmAI-Home-${version}-beta-`) && /\.(dmg|exe|AppImage|deb)$/.test(asset.name));
console.table(installers.map((asset) => ({ installer: asset.name, downloads: asset.download_count })));
for (const platform of ["macos", "windows", "linux"]) console.log(`${platform}: ${installers.filter((asset) => asset.name.includes(`-beta-${platform}-`)).reduce((sum, asset) => sum + asset.download_count, 0)} installer downloads`);
console.log("Counts include repeated downloads; GitHub does not identify individual downloaders.\n");

// wilm.ai's account on Cloudflare (apps/site/wrangler.jsonc).
const ACCOUNT = "055d00c523a88d6e0c0f4056c9fc1d75";
const DAYS = 14;
const query = `SELECT toDate(timestamp) AS day,
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
    "Home page views": Number(r.pageViews),
    "update checks": Number(r.appChecks),
    "≈ apps running": Math.round(Number(r.appChecks) / 4),
    "older builds' checks": Number(r.otherChecks),
  })));
  console.log("A running app checks for updates at start and every 6 hours, about four times a day. Older and development builds check with their own name.");
} catch (err) {
  console.log(`wilm.ai's numbers need the cf CLI, signed in to Cloudflare (${err instanceof Error ? err.message.split("\n")[0] : String(err)}).`);
}
