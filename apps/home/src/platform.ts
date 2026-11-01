/** Capabilities shared by the UI; native Tauri does not always mean desktop. */
export type AppPlatform = "web" | "desktop" | "ios" | "android";
export function detectPlatform(native: boolean, target = "", userAgent = ""): AppPlatform {
  if (!native) return "web";
  if (target === "ios" || target === "android") return target;
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  return "desktop";
}
export const appPlatform = detectPlatform(
  "__TAURI_INTERNALS__" in globalThis,
  typeof __APP_PLATFORM__ === "undefined" ? "" : __APP_PLATFORM__,
  globalThis.navigator?.userAgent ?? ""
);
export const isNativeApp = appPlatform !== "web";
export const isMobileApp = appPlatform === "ios" || appPlatform === "android";
export const isDesktopApp = appPlatform === "desktop";
