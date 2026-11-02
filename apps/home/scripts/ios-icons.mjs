/** Package the committed desktop icon for iOS; generated sizes stay out of Git. */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const home = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const output = mkdtempSync(join(tmpdir(), "wilmai-ios-icons-"));
try {
  execFileSync(process.execPath, [require.resolve("@tauri-apps/cli/tauri.js"),
    "icon", join(home, "src-tauri/icons/icon.png"), "--output", output], { cwd: home });
  const icons = join(output, "ios");
  cpSync(icons, join(home, "src-tauri/icons/ios"), { recursive: true });
  const catalog = join(home, "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset");
  // Tauri init copies icons/ios into a new catalog; later builds refresh existing projects here.
  if (existsSync(catalog)) cpSync(icons, catalog, { recursive: true });
  const apple = join(home, "src-tauri/gen/apple");
  if (existsSync(apple)) {
    const projects = readdirSync(apple).filter((name) => name.endsWith(".xcodeproj"));
    if (projects.length > 1) throw new Error("Expected one generated iOS app project");
    // ios:init may be recovering a directory with assets but no project yet.
    if (projects.length === 1) {
      const project = join(apple, projects[0], "project.pbxproj");
      const original = readFileSync(project, "utf8");
      let targets = 0;
      // XcodeGen regeneration can drop this setting. Add it only to app target
      // configurations, preserving the owner's local signing/capability settings.
      const updated = original.replace(/(buildSettings = \{)([\s\S]*?)(\n[ \t]*\};)/g, (all, open, body, close) => {
        if (!body.includes("PRODUCT_BUNDLE_IDENTIFIER =")) return all;
        targets++;
        const setting = /ASSETCATALOG_COMPILER_APPICON_NAME = [^;]+;/;
        return open + (setting.test(body)
          ? body.replace(setting, "ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;")
          : "\n\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;" + body) + close;
      });
      if (!targets) throw new Error("Cannot locate the generated iOS app build settings");
      if (updated !== original) writeFileSync(project, updated);
    }
  }
  console.log("iOS icons refreshed from the desktop app icon.");
} finally {
  rmSync(output, { recursive: true, force: true });
}
