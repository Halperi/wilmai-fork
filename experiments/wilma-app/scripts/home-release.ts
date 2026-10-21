/** Shared release metadata; no signing secrets belong in these objects. */

/** One update feed for every platform; each platform has its own entry under `platforms`. */
export const HOME_FEED = "https://wilm.ai/app/latest.json";

export function assetName(version: string, platform: string, arch: string, suffix: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Home releases need a stable numeric version and a separate beta label.");
  if (!["macos", "windows", "linux"].includes(platform) || !["arm64", "x64"].includes(arch) || !/^[a-zA-Z0-9.]+$/.test(suffix)) throw new Error("Invalid artifact platform or suffix.");
  // The Mac build includes local AI, which needs Apple Silicon.
  if (platform === "macos" && arch !== "arm64") throw new Error("The Mac build is for Apple Silicon.");
  return `WilmAI-Home-${version}-beta-${platform}-${arch}.${suffix}`;
}

/** One feed for every platform in the release: each platform's own entry, the same version and notes. */
export function releaseFeeds(input: { version: string; notes: string; date: string; platforms: { platform: string; signature: string; archive: string }[] }) {
  if (!input.platforms.length) throw new Error("A feed needs at least one platform.");
  const feeds = input.platforms.map((p) => releaseFeed({ ...input, ...p }));
  return { ...feeds[0], platforms: Object.assign({}, ...feeds.map((f) => f.platforms)) as Record<string, { signature: string; url: string }> };
}

export function releaseFeed(input: { version: string; platform: string; signature: string; archive: string; notes: string; date: string }) {
  const expected = `https://github.com/aikarjal/wilmai/releases/download/home-v${input.version}/WilmAI-Home-${input.version}-beta-`;
  if (!input.archive.startsWith(expected)) throw new Error("Update archive must be an immutable asset for this Home version.");
  if (!input.signature.trim()) throw new Error("The updater signature is missing.");
  return { version: input.version, notes: input.notes, pub_date: input.date, url: "https://wilm.ai/app", platforms: { [input.platform]: { signature: input.signature.trim(), url: input.archive } } };
}
