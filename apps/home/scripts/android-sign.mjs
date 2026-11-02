/** Sign the owner's APK with a persistent, private local identity. Nothing is uploaded. */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const home = fileURLToPath(new URL("../", import.meta.url));
const sdk = process.env.ANDROID_HOME; if (!sdk) throw new Error("Set ANDROID_HOME first.");
const privateDir = join(homedir(), "Library/Application Support/WilmAI Home Development/android-signing");
mkdirSync(privateDir, { recursive: true, mode: 0o700 }); chmodSync(privateDir, 0o700);
const key = join(privateDir, "wilmai-home.p12"); const passwordFile = join(privateDir, "password");
if (existsSync(key) && !existsSync(passwordFile)) throw new Error("Restore the signing password from your private backup; refusing to replace the key.");
if (!existsSync(passwordFile)) writeFileSync(passwordFile, randomBytes(32).toString("hex"), { mode: 0o600 });
chmodSync(passwordFile, 0o600);
const env = { ...process.env, WILMAI_ANDROID_SIGNING_PASSWORD: readFileSync(passwordFile, "utf8").trim() };
const run = (tool, args) => execFileSync(tool, args, { env, stdio: "inherit" });
if (!existsSync(key)) {
  run(join(process.env.JAVA_HOME || "", "bin/keytool"), ["-genkeypair", "-keystore", key, "-storetype", "PKCS12", "-alias", "wilmai-home", "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000", "-dname", "CN=WilmAI Home Personal", "-storepass:env", "WILMAI_ANDROID_SIGNING_PASSWORD", "-keypass:env", "WILMAI_ANDROID_SIGNING_PASSWORD"]);
}
chmodSync(key, 0o600);
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const inputs = walk(join(home, "src-tauri/gen/android/app/build/outputs/apk")).filter((p) => p.endsWith("-release-unsigned.apk") && (p.includes("aarch64") || p.includes("arm64") || p.includes("universal")));
if (inputs.length !== 1) throw new Error("Expected exactly one unsigned arm64 release APK.");
const entries = execFileSync("unzip", ["-Z", "-1", inputs[0]], { encoding: "utf8" }).split("\n");
const libraries = entries.filter((e) => /^lib\/.+\.so$/.test(e));
if (!libraries.length || libraries.some((e) => !e.startsWith("lib/arm64-v8a/"))) throw new Error("Expected arm64 libraries only.");
const pkg = JSON.parse(readFileSync(join(home, "package.json"), "utf8"));
const out = join(home, ".release/android", `WilmAI-Home-${pkg.version}-arm64.apk`); mkdirSync(dirname(out), { recursive: true });
const tools = join(sdk, "build-tools/36.0.0");
run(join(tools, "zipalign"), ["-f", "-P", "16", "4", inputs[0], out]);
run(join(tools, "apksigner"), ["sign", "--ks", key, "--ks-key-alias", "wilmai-home", "--ks-pass", "env:WILMAI_ANDROID_SIGNING_PASSWORD", "--key-pass", "env:WILMAI_ANDROID_SIGNING_PASSWORD", out]);
run(join(tools, "apksigner"), ["verify", "--verbose", out]);
run(join(tools, "zipalign"), ["-c", "-P", "16", "4", out]);
console.log(`Signed APK: ${out}`);
console.log(`Keep a private backup of ${privateDir}; future updates require the same signing identity.`);
