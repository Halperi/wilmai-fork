import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/bricolage-grotesque/wdth.css";
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/600.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "./ui/styles.css";
import { App } from "./ui/App";
import { getState, loadPersisted, loadSecrets, updateSettings } from "./data/store";
import { appEdition } from "./data/edition";
import { resume } from "./data/engine";
import { runJev } from "./jev/runner";
import { runLuna } from "./luna/events";
import { startUpdateChecks } from "./data/updates";
import { isDesktopApp } from "./wilma/transport";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";

if (isDesktopApp) setUpDesktopWindow();

/**
 * The desktop window has no title bar: the sidebar and top bar are where it's
 * grabbed (and double-clicked to zoom). Links open in the normal browser.
 */
function setUpDesktopWindow() {
  document.documentElement.classList.add("desktop");
  if (/mac/i.test(navigator.platform)) document.documentElement.classList.add("mac");
  const grab = ".nav, .topbar, .hello, .week-head, .signin-side, .signin-panel, .inbox-tools";
  const interactive = "a, button, input, select, textarea, label, .search, .filter, .schools, .picked, h1, .sum, .lede, .facts, .notice, .seg";
  document.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement;
    if (e.button !== 0 || !target.closest(grab) || target.closest(interactive)) return;
    if (e.detail === 2) void getCurrentWindow().toggleMaximize();
    else void getCurrentWindow().startDragging();
  });
  document.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
    if (!link || !/^https:\/\//i.test(link.href)) return;
    e.preventDefault();
    void openUrl(link.href);
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

async function start() {
  const edition = await appEdition().catch(() => ({ localAi: false, signedUpdater: false }));
  const settings = getState().settings;
  // Replacing Local AI with Standard cannot keep an unavailable provider enabled.
  // Leave the key and downloaded weights intact; choosing OpenAI remains explicit.
  if (!edition.localAi && (settings.aiProvider === "local" || settings.localAI?.setupPending)) {
    updateSettings({ aiProvider: "off", ...(settings.localAI ? { localAI: { ...settings.localAI, setupPending: false } } : {}) });
  }
  void loadPersisted().then(({ session }) => resume(session));
  // Once, on the first start after the key moved out of the keychain, macOS may ask; nothing waits for it.
  void loadSecrets().then(() => (void runJev(), runLuna()));
}
void start();
startUpdateChecks();
