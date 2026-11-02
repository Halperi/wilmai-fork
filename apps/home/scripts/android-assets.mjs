/** Deterministic Android assets and privacy settings; regenerate after tauri android init. */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const home = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const output = mkdtempSync(join(tmpdir(), "wilmai-android-icons-"));
try {
  execFileSync(process.execPath, [require.resolve("@tauri-apps/cli/tauri.js"), "icon", join(home, "src-tauri/icons/icon.png"), "--output", output], { cwd: home });
  const icons = join(output, "android");
  cpSync(icons, join(home, "src-tauri/icons/android"), { recursive: true });
  const project = join(home, "src-tauri/gen/android");
  if (!existsSync(join(project, "app/build.gradle.kts"))) throw new Error("Run pnpm android:init first.");
  cpSync(icons, join(project, "app/src/main/res"), { recursive: true });
  const gradle = join(project, "app/build.gradle.kts");
  let script = readFileSync(gradle, "utf8");
  if (!script.includes('applicationId = "fi.halperi.wilmai.home"')) throw new Error("Initialize with tauri.android.conf.json before packaging.");
  // Current CLI template defaults to SDK 37; the public stable SDK available to this app is 36.
  script = script.replace(/compileSdk = \d+/, "compileSdk = 36").replace(/targetSdk = \d+/, "targetSdk = 36").replace(/minSdk = \d+/, "minSdk = 34");
  writeFileSync(gradle, script);
  const manifest = join(project, "app/src/main/AndroidManifest.xml");
  let xml = readFileSync(manifest, "utf8").replace('<manifest xmlns:android="http://schemas.android.com/apk/res/android">', '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">');
  if (!xml.includes('android.permission.SCHEDULE_EXACT_ALARM')) xml = xml.replace('<application', '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" tools:node="remove" />\n    <uses-permission android:name="android.permission.USE_EXACT_ALARM" tools:node="remove" />\n    <application');
  if (!xml.includes('android:allowBackup=')) xml = xml.replace('<application', '<application android:allowBackup="false" android:fullBackupContent="@xml/backup_rules" android:dataExtractionRules="@xml/data_extraction_rules"');
  xml = xml.replace(/android:usesCleartextTraffic="[^"]*"/, 'android:usesCleartextTraffic="' + (process.argv.includes("--dev") ? '${usesCleartextTraffic}' : 'false') + '"');
  writeFileSync(manifest, xml);
  const resource = join(project, "app/src/main/res/xml"); mkdirSync(resource, { recursive: true });
  const excluded = ["root", "file", "database", "sharedpref", "external"].map((domain) => '<exclude domain="' + domain + '" path="." />').join("\n");
  writeFileSync(join(resource, "backup_rules.xml"), '<full-backup-content>\n' + excluded + '\n</full-backup-content>\n');
  writeFileSync(join(resource, "data_extraction_rules.xml"), '<data-extraction-rules><cloud-backup>\n' + excluded + '\n</cloud-backup><device-transfer>\n' + excluded + '\n</device-transfer></data-extraction-rules>\n');
  console.log("Android desktop icon, backup exclusions and inexact-alarm policy applied.");
} finally { rmSync(output, { recursive: true, force: true }); }
