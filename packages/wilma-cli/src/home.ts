/*
 * `wilma home`: where to get WilmAI Home, the desktop app. The addresses are
 * wilm.ai's own, which forward to the current installer, so a new Home release
 * needs no new CLI.
 */

export interface HomeInfo {
  app: string;
  about: string;
  page: string;
  downloads: { platform: "macos" | "windows"; requires: string; url: string; firstStart: string }[];
  logins: string;
  hint: string;
}

export const HOME: HomeInfo = {
  app: "WilmAI Home (beta)",
  about:
    "A Wilma app for your computer, from the same project: today's lessons, messages, homework, exams and grades in one view, for students and parents. Free and open source; AI is optional.",
  page: "https://wilm.ai/home",
  downloads: [
    {
      platform: "macos",
      requires: "Apple Silicon (M1 or newer), macOS 13.3 or later",
      url: "https://wilm.ai/get/mac",
      firstStart: "The app isn't signed by Apple yet, so macOS stops it the first time: choose Done, then System Settings → Privacy & Security → Open Anyway.",
    },
    {
      platform: "windows",
      requires: "Windows 10 or 11, 64-bit",
      url: "https://wilm.ai/get/windows",
      firstStart: "The installer isn't signed yet. Windows warns before the first start: choose More info, then Run anyway. A school computer may not allow it.",
    },
  ],
  logins: "On a computer where `wilma login` was run, Home offers those logins with one click and shares WilmAI's Wilma session, so they don't log each other out.",
  hint: "Give the user the link for their computer; downloading and installing the app is their step.",
};

export function homeText(info: HomeInfo = HOME): string {
  const names = { macos: "Mac", windows: "Windows" };
  const width = Math.max(...info.downloads.map((d) => d.url.length));
  return [
    info.app,
    info.about,
    "",
    ...info.downloads.flatMap((d) => [`  ${names[d.platform].padEnd(8)} ${d.url.padEnd(width)}  ${d.requires}`, `  ${"".padEnd(8)} ${d.firstStart}`]),
    "",
    info.logins,
    `More: ${info.page}`,
  ].join("\n");
}
