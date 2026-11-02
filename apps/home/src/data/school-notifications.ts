/** Pure notification planning shared by mobile transports; never asks an AI or opens a Wilma message. */
import type { AppState } from "./store";
import { buildFeed } from "./feed";
import { calendarEvents } from "./calendar";
import { dayTimes, knownLessons } from "./schedule";
import { addDays, dateOf, shortDate } from "./dates";
import { intelligenceOn } from "./model";
import { loginOfId } from "./logins";
import { t } from "../i18n";

export interface NotificationOptions {
  messages: boolean; notes: boolean; grades: boolean; reminders: boolean;
  digest: boolean; digestTime: string; details: boolean; background: boolean;
}
export const notificationOptions = (s: AppState["settings"]): NotificationOptions => ({
  messages: true, notes: true, grades: true, reminders: true, digest: false,
  digestTime: "19:00", details: false, background: true, ...s.schoolNotifications,
});
export interface NotificationLedger { sources: Record<string, Record<string, string>> }
export interface SchoolNotice {
  id: string; source: string; fingerprint: string;
  kind: "messages" | "notes" | "grades" | "reminders" | "digest";
  view: "today" | "inbox" | "notes" | "grades"; item: string | null;
  title: string; body: string; at: number;
}
const text = (s: string) => s.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);

/** Keep a separate first observation per login/category: enabling this never dumps old school history. */
export function schoolNotices(state: AppState, now: number): { ledger: NotificationLedger; notices: SchoolNotice[] } {
  const snap = state.snapshot;
  const ledger = structuredClone(state.local.schoolNotificationLedger ?? { sources: {} });
  const entries: SchoolNotice[] = [];
  if (!snap || snap.account.via === "demo") return { ledger, notices: [] };
  const options = notificationOptions(state.settings);
  const items = buildFeed(state);
  for (const item of items) {
    if (item.kind === "news" || item.own) continue;
    const message = item.kind === "message";
    const source = message ? `messages:${loginOfId(item.id ?? 0)}` : `notes:${item.note?.child}`;
    const name = item.children.map((n) => snap.children.find((c) => c.number === n)?.first).filter(Boolean).join(", ");
    entries.push({ id: item.key, source, fingerprint: message ? String(item.replyCount) : JSON.stringify([item.note?.typeLabel, item.note?.note, item.note?.start, item.note?.end]),
      kind: message ? "messages" : "notes", view: message ? "inbox" : "notes",
      // Note keys contain school text. Keep it out of the OS notification database.
      item: message ? item.key : null, at: item.at.getTime(),
      title: message ? t("New Wilma message") : item.task ? t("An absence needs explaining") : t("New lesson note"),
      body: text(`${name ? `${name}: ` : ""}${item.title}`) });
  }
  const sources = new Set<string>();
  for (const login of snap.logins ?? [{ slot: 0 }]) sources.add(`messages:${login.slot}`);
  for (const child of snap.children) {
    const data = snap.perChild[child.number];
    if (!data?.syncedAt) continue;
    sources.add(`notes:${child.number}`);
    if (!data.overview) continue;
    sources.add(`grades:${child.number}`);
    for (const exam of data.overview.grades) entries.push({
      id: `grade:${child.number}:${exam.date}:${exam.subjectCode}:${exam.name}`,
      source: `grades:${child.number}`, fingerprint: JSON.stringify([exam.grade, exam.verbalGrade]),
      kind: "grades", view: "grades", item: null, at: now,
      title: t("New exam result"), body: text(`${child.first}: ${exam.subject || exam.name} · ${exam.grade ?? exam.verbalGrade ?? ""}`),
    });
  }
  const notices: SchoolNotice[] = [];
  for (const source of sources) {
    const previous = ledger.sources[source];
    const observed = entries.filter((e) => e.source === source);
    for (const entry of observed) {
      if (previous && previous[entry.id] !== entry.fingerprint
        && !(entry.kind === "messages" && previous[entry.id] !== undefined && Number(entry.fingerprint) <= Number(previous[entry.id])) && options[entry.kind]
        && (entry.kind === "grades" || (entry.at <= now + 60_000 && entry.at >= now - 2 * 86_400_000))
        && (entry.kind !== "grades" || JSON.parse(entry.fingerprint).some(Boolean))
        && !(entry.kind === "messages" && (state.local.opened[entry.id] ?? 0) >= entry.at)) notices.push(entry);
    }
    // Keep the currently authoritative list, bounding disk use as Wilma's recent lists move on.
    ledger.sources[source] = Object.fromEntries(observed.map((e) => [e.id, e.fingerprint]));
  }
  return { ledger, notices };
}

export interface TomorrowDigest { day: string; lines: string[]; updatedAt: number; hasAI: boolean }
/** Uses the existing, validated AI calendar readings; no extra cloud request or model-invented plan. */
export function tomorrowDigest(state: AppState, day: string): TomorrowDigest | null {
  const snap = state.snapshot;
  if (!snap) return null;
  const lines: string[] = [];
  for (const child of snap.children) {
    const data = snap.perChild[child.number];
    const times = dayTimes(knownLessons(data)).get(day);
    if (times) lines.push(t("{name}: school {start}–{end}", { name: child.first, start: times.start, end: times.end }));
  }
  const hasAI = intelligenceOn(state.settings);
  const events = calendarEvents(snap, buildFeed(state), state.local.calendar, { from: day, until: day, children: [] }, hasAI ? state.luna : {});
  for (const event of events.filter((e) => e.sure)) {
    const names = event.children.map((n) => snap.children.find((c) => c.number === n)?.first).filter(Boolean).join(", ");
    lines.push(text(`${names ? `${names}: ` : ""}${event.start ? `${event.start} ` : ""}${event.title}${event.detail ? ` · ${event.detail}` : ""}`));
  }
  for (const item of buildFeed(state)) if (!item.done && item.deadline === day && item.actionLine)
    lines.push(text(t("By tomorrow: {step}", { step: item.actionLine })));
  return { day, lines: [...new Set(lines)].slice(0, 12), updatedAt: snap.syncedAt ? new Date(snap.syncedAt).getTime() : 0, hasAI };
}

/** One-shot future requests only: stale daily repeats would claim an old plan is fresh. */
export function scheduledSchoolNotices(state: AppState, now: number): SchoolNotice[] {
  const options = notificationOptions(state.settings);
  const today = dateOf(new Date(now));
  const match = /^(\d{2}):(\d{2})$/.exec(options.digestTime);
  const hour = Number(match?.[1]), minute = Number(match?.[2]);
  const validTime = match && hour < 24 && minute < 60;
  const out: SchoolNotice[] = [];
  // Two evenings fit the schedule window already fetched by the shared client.
  if (options.digest && validTime && intelligenceOn(state.settings)) for (let offset = 0; offset < 2; offset++) {
    const evening = addDays(today, offset);
    const at = new Date(`${evening}T${options.digestTime}:00`).getTime();
    const day = addDays(evening, 1);
    const digest = tomorrowDigest(state, day);
    if (at <= now || !digest?.lines.length || !digest.updatedAt || at - digest.updatedAt > 36 * 3_600_000) continue;
    out.push({ id: `digest:${day}`, source: "scheduled", fingerprint: JSON.stringify(digest.lines), kind: "digest", view: "today", item: null,
      title: t("Tomorrow's school day"), body: text(`${shortDate(day)} · ${digest.lines.join(" · ")} · ${t("Based on the latest downloaded information.")}`), at });
  }
  if (options.reminders) {
    const day = addDays(today, 1);
    const at = new Date(`${today}T18:00:00`).getTime();
    if (at > now) for (const item of buildFeed(state)) if (!item.done && item.deadline === day) out.push({
      id: `due:${item.key}:${day}`, source: "scheduled", fingerprint: item.actionLine ?? item.title,
      kind: "reminders", view: item.kind === "note" ? "notes" : "inbox", item: item.kind === "message" ? item.key : null,
      title: t("A school deadline is tomorrow"), body: text(item.actionLine ?? item.title), at,
    });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 24);
}

export function privateNotice(notice: SchoolNotice, details: boolean): Pick<SchoolNotice, "title" | "body"> {
  return details ? { title: text(notice.title), body: text(notice.body) } : { title: "WilmAI Home", body: notice.kind === "digest"
    ? t("Tomorrow's summary is ready. Open the app to read it.")
    : notice.kind === "reminders" ? t("A school deadline is approaching. Open the app for details.")
    : t("New school information is available. Open the app for details.") };
}
