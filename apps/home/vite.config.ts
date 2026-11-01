import { execSync } from "node:child_process";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { bridge } from "./bridge/bridge.ts";

const repoRoot = resolve(import.meta.dirname, "../..");

/** Which build this is, for Settings: the commit (with "+" when there were uncommitted changes) and when it was built. */
function buildStamp(): string {
  const git = (args: string) => {
    try {
      return execSync(`git ${args}`, { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "";
    }
  };
  const commit = git("rev-parse --short HEAD") || "unknown";
  const dirty = git("status --porcelain") ? "+" : "";
  const when = new Date().toLocaleString("en-GB", { timeZone: "Europe/Helsinki", dateStyle: "medium", timeStyle: "short" });
  return `${commit}${dirty} · ${when}`;
}

export default defineConfig(({ mode, command }) => ({
  plugins: [react(), bridge()],
  // The test Wilmas (src/demo/test-wilma.ts) only with the development server (the browser setup and `pnpm app`).
  define: { __APP_PLATFORM__: JSON.stringify(process.env.TAURI_ENV_PLATFORM ?? ""), __APP_BUILD__: JSON.stringify(buildStamp()), __TEST_WILMAS__: JSON.stringify(command === "serve") },
  // The desktop app loads its files from disk, so paths stay relative.
  base: mode === "tauri" ? "./" : "/",
  resolve: {
    // wilma-client's parsers import cheerio; use this app's copy (its browser build).
    dedupe: ["cheerio"],
    alias: { "@wilma-client": resolve(repoRoot, "packages/wilma-client") },
  },
  // Tauri's own dev server port is set in src-tauri/tauri.conf.json.
  server: { host: process.env.TAURI_DEV_HOST || "127.0.0.1", port: 5199, strictPort: true, fs: { allow: [repoRoot] }, ...(process.env.TAURI_DEV_HOST ? { hmr: { host: process.env.TAURI_DEV_HOST, port: 5196 } } : {}) },
  preview: { port: 5198, strictPort: true },
  clearScreen: false,
  build: { outDir: mode === "tauri" ? "dist-tauri" : "dist", target: mode === "tauri" ? "safari16" : "es2022" },
}));
