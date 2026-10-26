/* Finnish school time: every date here is a Europe/Helsinki calendar date, YYYY-MM-DD. */
import { finnishDateString, finnishParts } from "@wilma-client/src/finnish-time";

export const today = (): string => finnishDateString(new Date());

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(iso: string): number {
  return (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
}

export function mondayOf(iso: string): string {
  return addDays(iso, -weekday(iso));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export function isoWeek(iso: string): number {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const FI_DAY = ["ma", "ti", "ke", "to", "pe", "la", "su"];
const FI_DAY_LONG = ["maanantai", "tiistai", "keskiviikko", "torstai", "perjantai", "lauantai", "sunnuntai"];
const SV_DAY = ["mån", "tis", "ons", "tors", "fre", "lör", "sön"];
const SV_DAY_LONG = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];
const SV_MONTH = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const FI_MONTH = ["tammikuuta", "helmikuuta", "maaliskuuta", "huhtikuuta", "toukokuuta", "kesäkuuta", "heinäkuuta", "elokuuta", "syyskuuta", "lokakuuta", "marraskuuta", "joulukuuta"];

/** The language dates are shown in (set with the app's language; see i18n). */
let language: "en" | "fi" | "sv" = "en";
export function setDateLanguage(lang: "en" | "fi" | "sv"): void {
  language = lang;
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* English, always: what Jev reads (its inputs, and so its cached answers, don't change with the app's language). */
export const dayNameLongEn = (iso: string) => DAY_LONG[weekday(iso)];
export function longDateEn(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_LONG[m - 1]}`;
}

/* On screen, in the app's language. */

/** "Wed" / "Ke": a column heading */
export const dayName = (iso: string) => (language === "fi" ? capital(FI_DAY[weekday(iso)]) : language === "sv" ? capital(SV_DAY[weekday(iso)]) : DAY[weekday(iso)]);
/** "Wednesday" / "Keskiviikko" */
export const dayNameLong = (iso: string) =>
  language === "fi" ? capital(FI_DAY_LONG[weekday(iso)]) : language === "sv" ? capital(SV_DAY_LONG[weekday(iso)]) : DAY_LONG[weekday(iso)];

/** "Wed 7 Oct" / "ke 7.10." */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (language === "sv") return `${SV_DAY[weekday(iso)]} ${d}.${m}.`;
  return language === "fi" ? `${FI_DAY[weekday(iso)]} ${d}.${m}.` : `${DAY[weekday(iso)]} ${d} ${MONTH[m - 1]}`;
}

/* Finnish, always: what goes to Wilma (a message's subject to a teacher), whatever the app's language. */
export function shortDateFi(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${FI_DAY[weekday(iso)]} ${d}.${m}.`;
}
export function dateSpanFi(from: string, to: string): string {
  const [, m1, d1] = from.split("-").map(Number);
  const [, m2, d2] = to.split("-").map(Number);
  return `${FI_DAY[weekday(from)]}–${FI_DAY[weekday(to)]} ${m1 === m2 ? `${d1}.–${d2}.${m2}.` : `${d1}.${m1}.–${d2}.${m2}.`}`;
}

/** A span of days, short: "Mon–Fri 5–9 Oct" / "ma–pe 5.–9.10."; across months "Wed–Mon 30 Sep–5 Oct" / "ke–ma 30.9.–5.10.". */
export function dateSpan(from: string, to: string): string {
  const [, m1, d1] = from.split("-").map(Number);
  const [, m2, d2] = to.split("-").map(Number);
  if (language !== "en") {
    const days = language === "sv" ? SV_DAY : FI_DAY;
    return `${days[weekday(from)]}–${days[weekday(to)]} ${m1 === m2 ? `${d1}.–${d2}.${m2}.` : `${d1}.${m1}.–${d2}.${m2}.`}`;
  }
  return `${DAY[weekday(from)]}–${DAY[weekday(to)]} ${m1 === m2 ? `${d1}–${d2} ${MONTH[m2 - 1]}` : `${d1} ${MONTH[m1 - 1]}–${d2} ${MONTH[m2 - 1]}`}`;
}

/** "7 October" / "7. lokakuuta" */
export function longDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return language === "fi" ? `${d}. ${FI_MONTH[m - 1]}` : language === "sv" ? `${d} ${SV_MONTH[m - 1]}` : `${d} ${MONTH_LONG[m - 1]}`;
}

const DAY_WORDS = { en: ["Today", "Tomorrow", "Yesterday"], fi: ["Tänään", "Huomenna", "Eilen"], sv: ["I dag", "I morgon", "I går"] };

/** "Today", "Tomorrow", "Yesterday", "Thursday", "Wed 7 Oct" (or in Finnish: "Tänään", "Huomenna", "Eilen", "Torstai", "ke 7.10."; in Swedish "I dag"…) */
export function relativeDay(iso: string, now = today()): string {
  const diff = daysBetween(now, iso);
  const [todayWord, tomorrow, yesterday] = DAY_WORDS[language];
  if (diff === 0) return todayWord;
  if (diff === 1) return tomorrow;
  if (diff === -1) return yesterday;
  if (diff > 1 && diff < 7) return dayNameLong(iso);
  return shortDate(iso);
}

/** "Tomorrow, Thu 8 Oct" for yesterday, today and tomorrow; otherwise the date alone ("Fri 9 Oct"), which already names the day. */
export function dayWithDate(iso: string, now = today()): string {
  return Math.abs(daysBetween(now, iso)) <= 1 ? `${relativeDay(iso, now)}, ${shortDate(iso)}` : shortDate(iso);
}

/** Is this the word relativeDay() gives for today / yesterday (in any of the languages)? */
export const isTodayWord = (word: string) => Object.values(DAY_WORDS).some(([w]) => w === word);
export const isYesterdayWord = (word: string) => Object.values(DAY_WORDS).some(([, , w]) => w === word);

export function dateOf(instant: Date): string {
  return finnishDateString(instant);
}

/** "13:37" today, "Yesterday", "Wed 7 Oct" */
export function whenShort(instant: Date, now = today()): string {
  const iso = dateOf(instant);
  if (iso === now) return hasTime(instant) ? clock(instant) : relativeDay(iso, now);
  return relativeDay(iso, now);
}

/** Wilma gives bulletins a date without a time; they're kept at midnight, which isn't a time to show. */
export function hasTime(instant: Date): boolean {
  const p = finnishParts(instant);
  return p.hour !== 0 || p.minute !== 0;
}

/** The full stamp for a reader: "Today, Wed 7 Oct 14:58", "Mon 5 Oct 09:20", or just the day when Wilma gives no time. */
export function whenLong(instant: Date, now = today()): string {
  const iso = dateOf(instant);
  const relative = relativeDay(iso, now);
  const day = isTodayWord(relative) || isYesterdayWord(relative) ? `${relative}, ${shortDate(iso)}` : shortDate(iso);
  return hasTime(instant) ? `${day} ${clock(instant)}` : day;
}

export function clock(instant: Date): string {
  const p = finnishParts(instant);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/**
 * A deadline as Wilma shows it: midnight is the end of the day before (Wilma
 * stores "18.10. 00:00" and shows "Päättyy 17.10."), so the day without a
 * time; any other time on its own day.
 */
export function deadlineDay(instant: Date): { day: string; time: string | null } {
  const time = clock(instant);
  return time === "00:00" ? { day: addDays(dateOf(instant), -1), time: null } : { day: dateOf(instant), time };
}

/** A deadline in a line of text: "Sat 17 Oct" for the end of a day, else "Sat 17 Oct 16:00". */
export const deadlineText = (instant: Date): string => {
  const { day, time } = deadlineDay(instant);
  return time ? `${shortDate(day)} ${time}` : shortDate(day);
};

export function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function nowMinutes(): number {
  const p = finnishParts(new Date());
  return p.hour * 60 + p.minute;
}

/**
 * Dates a Finnish school text mentions: "ke 7.10.", "7.10.2026", "pe 9.10. klo 9".
 * A date without a year is placed in the school year around `anchor`.
 */
export function mentionedDates(text: string, anchor: string): string[] {
  return [...new Set(dateMatches(text, anchor).map((m) => m.iso))].sort();
}

const RELATIVE: Record<string, number> = { tänään: 0, today: 0, idag: 0, huomenna: 1, tomorrow: 1, imorgon: 1, ylihuomenna: 2 };

/**
 * Every date a text mentions, in order, with the words it used: "ke 7.10.",
 * "7.10.2026", or "huomenna" / "tänään" counted from `anchor` (the day the
 * message was sent). Code does the calendar; Jev only points at one of these.
 */
export function dateMatches(text: string, anchor: string): { iso: string; said: string; index: number }[] {
  const out: { iso: string; said: string; index: number }[] = [];
  const [anchorYear] = anchor.split("-").map(Number);
  // "7.10.", "7.10.2026" and "7.10.26" (a two-digit year is this century); not a time ("klo 9.10.").
  for (const match of text.matchAll(/(?<![\d.])(?<!klo\s{0,2})(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2}(?![\d]))?(?![\d])/gi)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    if (day < 1 || day > 31 || month < 1 || month > 12) continue;
    let year = match[3] ? (match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])) : anchorYear;
    let iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!match[3]) {
      // "12.1." written in October means next January.
      const diff = daysBetween(anchor, iso);
      if (diff < -120) year += 1;
      else if (diff > 245) year -= 1;
      iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    if (Number.isNaN(Date.parse(`${iso}T12:00:00Z`)) || addDays(iso, 0) !== iso) continue;
    // Keep a weekday written before the date ("ke 7.10.") with it.
    const before = text.slice(Math.max(0, (match.index ?? 0) - 4), match.index ?? 0);
    const weekday = /(ma|ti|ke|to|pe|la|su)\s$/i.exec(before)?.[0] ?? "";
    out.push({ iso, said: `${weekday}${match[0]}`, index: (match.index ?? 0) - weekday.length });
  }
  for (const match of text.matchAll(/(?<!\p{L})(ylihuomenna|huomenna|tänään|tomorrow|today|imorgon|idag)(?!\p{L})/giu)) {
    out.push({ iso: addDays(anchor, RELATIVE[match[1].toLowerCase()]), said: match[0], index: match.index ?? 0 });
  }
  return out.sort((a, b) => a.index - b.index);
}
