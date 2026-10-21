/** Aggregate public installer counts, without tracking users in the app. */
import { execFileSync } from "node:child_process";
import { version } from "../package.json";

const release = JSON.parse(execFileSync("gh", ["api", `repos/aikarjal/wilmai/releases/tags/home-v${version}`], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })) as { assets: { name: string; download_count: number }[] };
const installers = release.assets.filter((asset) => asset.name.startsWith(`WilmAI-Home-${version}-beta-`) && /\.(dmg|exe|AppImage|deb)$/.test(asset.name));
console.table(installers.map((asset) => ({ installer: asset.name, downloads: asset.download_count })));
for (const platform of ["macos", "windows", "linux"]) console.log(`${platform}: ${installers.filter((asset) => asset.name.includes(`-beta-${platform}-`)).reduce((sum, asset) => sum + asset.download_count, 0)} installer downloads`);
console.log("Counts include repeated downloads; GitHub does not identify individual downloaders.");
