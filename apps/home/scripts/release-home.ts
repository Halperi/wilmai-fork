/** Local Mac release preparation. Never uploads assets or promotes a feed. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOME_FEED, assetName, releaseFeed } from "./home-release";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.some((arg) => arg !== "--check")) throw new Error("Usage: pnpm release:check|release:build");
const capture = (command: string, argv: string[]) => execFileSync(command, argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const run = (command: string, argv: string[]) => {
  try { execFileSync(command, argv, { cwd: root, stdio: "inherit", env: process.env }); }
  catch { throw new Error(`${command} failed. See its diagnostics above.`); } // Never serialize signing/notarization argv on failure.
};
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const app = await json(join(root, "package.json"));
const config = await json(join(root, "src-tauri/tauri.conf.json"));
const site = await json(join(root, "../../apps/site/lib/home-release.json"));
const cargo = await readFile(join(root, "src-tauri/Cargo.toml"), "utf8");
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const problems: string[] = [];
if (![config.version, site.version, cargoVersion].every((v) => v === app.version)) problems.push("App, Cargo, Tauri and website versions must match.");
if (config.identifier !== "ai.wilm.home") problems.push("The existing app identifier must be preserved.");
const dirty = capture("git", ["status", "--porcelain=v1"]).trim();
if (dirty) problems.push(`Working tree is not clean (${dirty.split("\n").length} changed/untracked entries). Review and commit only when ready, then rerun.`);
if (process.platform !== "darwin" || process.arch !== "arm64") problems.push("This command prepares the Mac release (with local AI) on an Apple Silicon Mac. Windows/Linux builds use their own build environments.");
let publicKey = "";
try {
  publicKey = (await readFile(join(root, "src-tauri/updater.pub"), "utf8")).trim();
  const decoded = Buffer.from(publicKey, "base64").toString("utf8").trim().split("\n");
  if (!decoded[0]?.startsWith("untrusted comment:") || Buffer.from(decoded[1] ?? "", "base64").length !== 42) throw new Error("Invalid public key");
  capture("git", ["ls-files", "--error-unmatch", "src-tauri/updater.pub"]);
} catch { problems.push("A valid, tracked Tauri PUBLIC key is required at src-tauri/updater.pub. Keep the private key in 1Password."); }
const identity = process.env.APPLE_SIGNING_IDENTITY ?? "";
if (!identity.startsWith("Developer ID Application:")) problems.push("APPLE_SIGNING_IDENTITY must select a Developer ID Application certificate; ad-hoc/local signatures cannot be released.");
else if (process.platform === "darwin" && !capture("security", ["find-identity", "-v", "-p", "codesigning"]).includes(`"${identity}"`)) problems.push("The selected Developer ID Application certificate/private key is not available in this Mac's Keychain.");
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) problems.push("TAURI_SIGNING_PRIVATE_KEY is required for updater signatures.");
const apiCredentials = Boolean(process.env.APPLE_API_KEY && process.env.APPLE_API_ISSUER && process.env.APPLE_API_KEY_PATH);
const idCredentials = Boolean(process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID);
if (!apiCredentials && !idCredentials) problems.push("Notarization needs APPLE_API_KEY / APPLE_API_ISSUER / APPLE_API_KEY_PATH or APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID.");
try { await readFile(join(root, "docs/releases", `${app.version}.md`)); } catch { problems.push("Release notes are required for this version."); }
if (problems.length) {
  console.error(`Home ${app.version} Beta · Mac preflight:\n${problems.map((p) => `- ${p}`).join("\n")}`);
  process.exitCode = 1;
} else if (args.includes("--check")) {
  console.log(`Home ${app.version} Beta · Mac: release prerequisites are present. No build or upload performed.`);
} else {
  const scratch = await mkdtemp(join(tmpdir(), "wilmai-home-release-"));
  try {
    // Tauri merges src-tauri/tauri.macos.conf.json (local AI) by itself; this adds only the release settings.
    const releaseConfig = join(scratch, "tauri.release.json");
    await writeFile(releaseConfig, JSON.stringify({ bundle: { createUpdaterArtifacts: true, macOS: { signingIdentity: identity, hardenedRuntime: true } }, plugins: { updater: { pubkey: publicKey, endpoints: [HOME_FEED] } } }));
    run("pnpm", ["typecheck"]);
    run("pnpm", ["test:ai"]);
    run("pnpm", ["test:release"]);
    run("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--features", "local-ai"]);
    const target = "aarch64-apple-darwin";
    run("pnpm", ["tauri", "build", "--ci", "--target", target, "--config", releaseConfig, "--bundles", "app,dmg"]);
    const bundles = join(root, "src-tauri/target", target, "release/bundle");
    const bundle = join(bundles, "macos/WilmAI Home.app");
    run("codesign", ["--verify", "--deep", "--strict", bundle]);
    run("xcrun", ["stapler", "validate", bundle]);
    run("spctl", ["--assess", "--type", "execute", bundle]);
    const dmgFiles = (await readdir(join(bundles, "dmg"))).filter((file) => file.endsWith(".dmg"));
    if (dmgFiles.length !== 1) throw new Error("Expected one DMG in the clean build.");
    const dmg = join(bundles, "dmg", dmgFiles[0]);
    // Tauri notarizes/staples the app. Also notarize the initial-download DMG.
    const notarizeArgs = apiCredentials ? ["--key", process.env.APPLE_API_KEY_PATH!, "--key-id", process.env.APPLE_API_KEY!, "--issuer", process.env.APPLE_API_ISSUER!] : ["--apple-id", process.env.APPLE_ID!, "--password", process.env.APPLE_PASSWORD!, "--team-id", process.env.APPLE_TEAM_ID!];
    run("xcrun", ["notarytool", "submit", dmg, "--wait", ...notarizeArgs]);
    run("xcrun", ["stapler", "staple", dmg]);
    run("xcrun", ["stapler", "validate", dmg]);
    const dest = join(root, ".release", app.version, "macos-arm64");
    await mkdir(dest, { recursive: true });
    const dmgName = assetName(app.version, "macos", "arm64", "dmg");
    const archiveName = assetName(app.version, "macos", "arm64", "app.tar.gz");
    await copyFile(dmg, join(dest, dmgName));
    const archive = join(bundles, "macos/WilmAI Home.app.tar.gz");
    await copyFile(archive, join(dest, archiveName));
    await copyFile(`${archive}.sig`, join(dest, `${archiveName}.sig`));
    const signature = await readFile(`${archive}.sig`, "utf8");
    const base = `https://github.com/aikarjal/wilmai/releases/download/home-v${app.version}/`;
    const notes = await readFile(join(root, "docs/releases", `${app.version}.md`), "utf8");
    const feed = releaseFeed({ version: app.version, platform: "darwin-aarch64", signature, archive: base + archiveName, notes, date: new Date().toISOString() });
    await writeFile(join(dest, "latest.json"), JSON.stringify(feed, null, 2) + "\n");
    await writeFile(join(dest, "download-entry.json"), JSON.stringify({ id: "macos-arm64", url: base + dmgName }, null, 2) + "\n");
    const sums = await Promise.all([dmgName, archiveName].map(async (file) => `${createHash("sha256").update(await readFile(join(dest, file))).digest("hex")}  ${file}`));
    await writeFile(join(dest, "SHA256SUMS"), sums.join("\n") + "\n");
    console.log(`Prepared ${dest}. Nothing uploaded or promoted. Rehearse a signed upgrade before enabling downloads.`);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
