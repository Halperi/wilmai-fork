/*
 * One feed for the whole family: messages, bulletins and teacher notes for
 * every child, with the models' answers turned into something to act on:
 * the decisions' probabilities (needs you, kind, scope) and Luna's reading
 * (the step for the guardian, its deadline, the dates). Code owns the
 * decisions; the probabilities only feed them.
 */
import type { LessonNote } from "@wilma-client/src/core";
import { addDays, dateOf, daysBetween, today } from "./dates";
import type { AppState } from "./store";
import { LUNA_THRESHOLDS, viewerOf, writtenByFamily, type Child, type JevAnswer, type JevRecord, type LunaEvent, type LunaRecord, type Snapshot } from "./model";
import { TRIAGE_PUPIL_QS, TRIAGE_QS, type Kind, type Scope } from "../jev/questions";
import { awaitingAnswer, slotState, type Invitation as Invite, type InvitationSlot as InviteSlot } from "@wilma-client/src/core";
import { clock, deadlineDay, shortDate } from "./dates";
import { t } from "../i18n";
import { examSuperseded, noteExam, type PupilExam } from "./note-exams";
import { aiNoteKinds, noteKind, type NoteKind } from "./notes";

export type ItemKind = "message" | "news" | "note";

/** Luna's reading of the item: the school's own sentence for the guardian's step, its deadline, the day it's about. */
export interface Detail {
  actionLine: string | null;
  deadline: string | null;
  eventDate: string | null;
  /** The second, narrower look at "needs action" (used only when the first was unsure). */
  confirm: number | null;
  /** The dated events Luna read (and its decisions' probabilities). */
  events: LunaEvent[];
  model: string | null;
}

export interface Triage {
  /** The question set it answered: a guardian's or a pupil's (questions.ts). */
  qs: string;
  /** Stage 1's answer, or stage 2's second look when stage 1 was unsure. */
  needsAction: number;
  /** Stage 1's own answer, before any second look. */
  firstNeedsAction: number;
  /** 0 (no date ahead) … 3 (today or tomorrow), computed in code from the deadline or day Jev picked. */
  urgency: number;
  kind: Kind;
  kindConfidence: number;
  /** Probability it's written about this child in particular. */
  aboutChild: number;
  scope: Scope;
  scopeConfidence: number;
  praise: number;
  /** Jev saw only the subject (the message hasn't been opened). */
  preliminary: boolean;
  model: string;
  answers: Record<string, JevAnswer>;
  detail: Detail | null;
}

export interface FeedItem {
  key: string;
  kind: ItemKind;
  id: number | null;
  children: string[];
  title: string;
  from: string | null;
  at: Date;
  text: string | null;
  preview: string;
  isNew: boolean;
  done: boolean;
  /** Dates the text mentions, today or later. */
  upcoming: string[];
  /** Whether the text mentions any date at all (past ones included). */
  dated: boolean;
  triage: Triage | null;
  /** The school's own sentence saying what the parent must do (stage 2). */
  actionLine: string | null;
  /** The deadline for it, and the day the item is about (stage 2; YYYY-MM-DD). */
  deadline: string | null;
  eventDate: string | null;
  /** Something the parent has to do that code knows for certain from Wilma's own data (no model needed). */
  task: { label: string; reason: string } | null;
  /** A message this family wrote (model.ts writtenByFamily): never a step for them, whatever the reading says. */
  own?: boolean;
  tone: "praise" | "neutral" | "concern" | null;
  replyCount: number;
  note?: NoteGroup;
  /** Important for the pupil, independently of a guardian's "needs you" tasks. */
  pupilExam?: PupilExam | null;
  /** A bulletin the school keeps in Wilma's permanent bulletins (pysyvät tiedotteet). */
  pinned?: boolean;
  /** When the reader pinned it to the top of the inbox (this app only), or null. */
  pinnedAt?: number | null;
  /** Event invitations: the slots (once read), the slot chosen, whether it still waits for an answer. */
  invite?: { data: Invite | null; status: string | null; extra: string | null; awaiting: boolean; chosen: InviteSlot | null };
}

export const NEEDS_YOU = 0.6;
const SCOPE_WEIGHT: Record<Scope, number> = { pupil: 1, group: 0.7, school: 0.4, wider: 0 };

/** Outstanding pupil exams need a parent's attention even when no guardian action is assigned. */
export function examsNeedingAttention(items: FeedItem[], from = today()): (FeedItem & { pupilExam: PupilExam })[] {
  return items.filter((item): item is FeedItem & { pupilExam: PupilExam } => Boolean(item.pupilExam && !item.done && (!item.pupilExam.date || item.pupilExam.date >= from)))
    .sort((a, b) => ((a.pupilExam.date ?? "9999") + (a.pupilExam.start ?? "")).localeCompare((b.pupilExam.date ?? "9999") + (b.pupilExam.start ?? "")));
}

/** One day's notes of one kind, e.g. a pre-approved absence across six lessons. */
export interface NoteGroup {
  key: string;
  child: string;
  date: string;
  start: string | null;
  end: string | null;
  typeLabel: string;
  typeClass: string;
  teachers: string[];
  subjects: string[];
  note: string | null;
  first: LessonNote;
}

/**
 * An absence Wilma marks as unexplained ("selvittämätön poissaolo") stays
 * that way until a guardian explains it in Wilma; once explained, its type
 * changes and the task disappears on the next sync.
 */
export function absenceTask(note: Pick<NoteGroup, "typeLabel" | "typeClass">): FeedItem["task"] {
  const label = `${note.typeLabel} ${note.typeClass}`;
  if (!/selvittämät|selvitettäv|unexplained|ej utredd|outredd|oklar frånvaro/i.test(label)) return null;
  return { label: t("Explain in Wilma"), reason: t("Wilma shows this absence as unexplained until a guardian explains it.") };
}

export function noteGroups(child: string, notes: LessonNote[]): NoteGroup[] {
  const groups = new Map<string, NoteGroup>();
  const sorted = [...notes].sort((a, b) => (a.date + (a.start ?? "")).localeCompare(b.date + (b.start ?? "")));
  for (const n of sorted) {
    const id = `${n.date}|${n.typeLabel}|${n.note ?? ""}`;
    let g = groups.get(id);
    if (!g) {
      g = {
        key: `note:${child}:${n.date}:${n.typeLabel}:${(n.note ?? "").slice(0, 40)}`,
        child,
        date: n.date,
        start: n.start,
        end: n.end,
        typeLabel: n.typeLabel,
        typeClass: n.typeClass,
        teachers: [],
        subjects: [],
        note: n.note ?? null,
        first: n,
      };
      groups.set(id, g);
    }
    if (n.subject && !g.subjects.includes(n.subject)) g.subjects.push(n.subject);
    if (n.teacher && !g.teachers.includes(n.teacher)) g.teachers.push(n.teacher);
    if (n.end) g.end = n.end;
  }
  return [...groups.values()];
}

function preview(text: string | null, fallback = ""): string {
  const source = (text ?? fallback).replace(/\s+/g, " ").trim();
  return source.length > 180 ? `${source.slice(0, 178)}…` : source;
}

/** What Luna read: the step and its deadline when quoted, and the first event's day (in the calendar's thresholds). */
function detailOf(rec: LunaRecord | undefined): Detail | null {
  if (!rec || rec.error) return null;
  const now = today();
  const T = LUNA_THRESHOLDS;
  const day = rec.events.find((e) => e.kind !== "deadline" && e.pDate >= T.keepDate && e.pCalendar + (e.pOptional ?? 0) >= T.keepCalendar && (e.endDate ?? e.date) >= now) ?? null;
  return {
    actionLine: rec.action?.quote ?? null,
    deadline: rec.action?.deadline ?? null,
    eventDate: day?.date ?? null,
    confirm: rec.action ? rec.action.pRequired : null,
    events: rec.events,
    model: rec.model ?? null,
  };
}

/** The days an item is about, still ahead: Luna's events (sure or suggested). */
const upcomingOf = (rec: LunaRecord | undefined) =>
  [...new Set((rec?.events ?? []).filter((e) => e.pDate >= LUNA_THRESHOLDS.keepDate && (e.endDate ?? e.date) >= today()).map((e) => e.date))].sort();

/** How soon, from the first date still ahead: 3 today or tomorrow, 2 this week, 1 within three weeks. */
export function urgencyOf(dates: (string | null | undefined)[]): number {
  const now = today();
  const next = dates.find((d): d is string => Boolean(d) && (d as string) >= now);
  if (!next) return 0;
  const days = daysBetween(now, next);
  return days <= 1 ? 3 : days <= 6 ? 2 : days <= 21 ? 1 : 0;
}

function triageOf(rec: JevRecord | undefined, detailRec: LunaRecord | undefined, preliminary: boolean): Triage | null {
  if (!rec || (rec.qs !== TRIAGE_QS && rec.qs !== TRIAGE_PUPIL_QS)) return null;
  const a = rec.answers;
  const first = a.needs_action?.type === "noul" ? a.needs_action.noul : 0;
  const detail = detailOf(detailRec);
  // The reading's look at the sentence itself (is this step required?): it decides when the first answer was unsure, and a
  // required step it quoted counts even when the first answer missed it (a polite or passive request).
  const action = detail?.confirm == null ? first : first >= 0.45 && first < 0.75 ? detail.confirm : Math.max(first, detail.confirm);
  const scope = a.scope?.type === "choice" ? (a.scope.choice as Scope) : "school";
  const scopeConfidence = a.scope?.type === "choice" ? a.scope.confidence : 0;
  const about = a.scope?.type === "choice" ? (a.scope.probabilities.pupil ?? 0) : 0;
  const praise = a.praise?.type === "noul" ? a.praise.noul : 0;
  const kind = a.kind?.type === "choice" ? (a.kind.choice as Kind) : "general";
  const kindConfidence = a.kind?.type === "choice" ? a.kind.confidence : 0;
  return {
    qs: rec.qs,
    needsAction: action,
    firstNeedsAction: first,
    urgency: 0, // set once the item's dates are known (buildFeed)
    kind,
    kindConfidence,
    aboutChild: about,
    scope,
    scopeConfidence,
    praise,
    preliminary,
    model: rec.model,
    answers: a,
    detail,
  };
}

/** The AI's reading of the teacher's words, else the note's own type as Notes counts it (data/notes.ts). */
function toneOf(note: NoteGroup, rec: JevRecord | undefined, kinds: Record<string, NoteKind>): FeedItem["tone"] {
  if (rec?.answers.tone?.type === "choice" && rec.answers.tone.confidence >= 0.5) return rec.answers.tone.choice as FeedItem["tone"];
  const kind = noteKind(note, kinds);
  return kind === "praise" ? "praise" : kind === "explain" || kind === "late" || kind === "forgot" || kind === "remark" ? "concern" : null;
}

/** Why an open invitation is a task: whole sentences per case (Finnish puts "by" after the date). */
function signUpReason(until: Date | undefined): string {
  if (!until) return t("The school asks you to sign up.");
  const { day, time } = deadlineDay(until);
  const days = daysBetween(today(), day);
  if (time === null) {
    if (days === 0) return t("The school asks you to sign up today.");
    if (days === 1) return t("The school asks you to sign up by tomorrow.");
    return t("The school asks you to sign up by {date}.", { date: shortDate(day) });
  }
  if (days === 0) return t("The school asks you to sign up, by {time} today.", { time });
  if (days === 1) return t("The school asks you to sign up, by {time} tomorrow.", { time });
  return t("The school asks you to sign up, by {date} {time}.", { date: shortDate(day), time });
}

export function buildFeed(state: Pick<AppState, "snapshot" | "local" | "jev" | "luna">): FeedItem[] {
  const snap = state.snapshot;
  if (!snap) return [];
  const now = today();
  const firstSync = snap.firstSyncAt ?? 0;
  // A student's own login: signing up for a meeting and explaining an absence are a guardian's to do, not the pupil's.
  const student = viewerOf(snap.account, state.local) === "student";
  const items: FeedItem[] = [];

  for (const m of Object.values(snap.messages)) {
    const key = `m:${m.id}`;
    const text = m.thread?.content ?? null;
    const triage = triageOf(state.jev[key], state.luna[key], !m.thread);
    const inviteData = m.thread?.invite ?? null;
    const invite = m.invite
      ? {
          data: inviteData,
          status: m.invite.status,
          extra: m.invite.extra,
          awaiting: Boolean(inviteData && inviteData.mustApply && awaitingAnswer(inviteData)),
          // Either guardian's sign-up counts for the family.
          chosen: inviteData?.slots.find((slot) => slot.selected || slot.selectedByOther) ?? null,
        }
      : undefined;
    // Written by this family: its dates still count (the calendar), but it's never a step for them.
    const own = writtenByFamily(m.sender, snap.children);
    const openUntil = inviteData?.slots
      .filter((slot) => slotState(slot) === "open" && slot.enrollEnd)
      .map((slot) => slot.enrollEnd!)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const inviteDates = [
      ...(invite?.chosen?.start ? [dateOf(invite.chosen.start)] : []),
      ...(invite?.awaiting && openUntil ? [deadlineDay(openUntil).day] : []),
    ].filter((d) => d >= now);
    items.push({
      key,
      kind: "message",
      id: m.id,
      children: m.children,
      title: m.subject || t("(no subject)"),
      from: m.sender,
      at: m.sentAt,
      text,
      preview: preview(text),
      isNew: !state.local.opened[key] && (m.unreadInWilma || m.sentAt.getTime() > firstSync),
      done: Boolean(state.local.done[key]),
      upcoming: [...new Set([...inviteDates, ...upcomingOf(state.luna[key])])].sort(),
      dated: Boolean(state.luna[key]?.events.length) || inviteDates.length > 0,
      triage,
      actionLine: own ? null : triage?.detail?.actionLine ?? null,
      deadline: own ? null : triage?.detail?.deadline ?? null,
      eventDate: triage?.detail?.eventDate ?? null,
      task: invite?.awaiting && !student ? { label: t("Sign up"), reason: signUpReason(openUntil) } : null,
      own,
      invite,
      tone: triage && triage.praise >= 0.6 && triage.aboutChild >= 0.5 ? "praise" : null,
      replyCount: m.replyCount,
      pinnedAt: state.local.pinned?.[key] ?? null,
    });
  }
  for (const n of Object.values(snap.news)) {
    const key = `n:${n.id}`;
    const text = n.detail?.content ?? null;
    const at = n.published ?? new Date(0);
    const triage = triageOf(state.jev[key], state.luna[key], !n.detail);
    items.push({
      key,
      kind: "news",
      id: n.id,
      children: n.children,
      title: n.title,
      from: n.author,
      at,
      text,
      preview: preview(text, n.subtitle ?? ""),
      isNew: !state.local.opened[key] && at.getTime() > firstSync,
      done: Boolean(state.local.done[key]),
      upcoming: upcomingOf(state.luna[key]),
      dated: Boolean(state.luna[key]?.events.length),
      triage,
      actionLine: triage?.detail?.actionLine ?? null,
      deadline: triage?.detail?.deadline ?? null,
      eventDate: triage?.detail?.eventDate ?? null,
      task: null,
      tone: null,
      replyCount: 0,
      pinned: n.pinned,
      pinnedAt: state.local.pinned?.[key] ?? null,
    });
  }
  for (const child of snap.children) {
    for (const note of noteGroups(child.number, snap.perChild[child.number]?.notes ?? [])) {
      // Notes on coming lessons wait for their day (the calendar reads them now).
      if (note.date > today()) continue;
      const key = note.key;
      const at = new Date(`${note.date}T${note.start ?? "08:00"}:00+03:00`);
      const exam = noteExam(snap, note, state.luna[key]);
      items.push({
        key,
        kind: "note",
        id: null,
        children: [child.number],
        title: note.typeLabel,
        from: note.teachers.join(", ") || null,
        at,
        text: note.note,
        preview: preview(note.note, note.subjects.join(", ")),
        isNew: !state.local.opened[key] && at.getTime() > firstSync,
        done: Boolean(state.local.done[key]),
        upcoming: [],
        dated: false,
        triage: null,
        actionLine: null,
        deadline: null,
        eventDate: null,
        task: student ? null : absenceTask(note),
        tone: toneOf(note, state.jev[key], aiNoteKinds(state.jev)),
        replyCount: 0,
        note,
        pupilExam: exam && !examSuperseded(key, exam, state.luna) ? exam : null,
      });
    }
  }
  // Urgency is code's job: the deadline Jev picked, else the day it's about, else any date ahead.
  for (const item of items) {
    if (item.triage) item.triage.urgency = urgencyOf([item.deadline, item.eventDate, ...item.upcoming]);
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** The date that matters most for an item: its deadline, the day it's about, or the first date ahead. */
export function keyDate(item: FeedItem): string | null {
  const now = today();
  return [item.deadline, item.eventDate, ...item.upcoming].find((d): d is string => Boolean(d) && (d as string) >= now) ?? null;
}

/** Higher first: how much an item needs the parent now. */
export function priority(item: FeedItem): number {
  // A task Wilma itself records outranks a model's reading; the newest first among them.
  if (item.task) return 3 - Math.min(1, daysBetween(dateOf(item.at), today()) / 30);
  const t = item.triage;
  if (!t) return 0;
  const when = keyDate(item);
  const soon = when ? Math.max(0, 1 - daysBetween(today(), when) / 14) : 0;
  return t.needsAction * 2 + t.urgency / 3 + soon * 0.5 + SCOPE_WEIGHT[t.scope] * 0.5;
}

/**
 * The app's rule for "needs you", from Jev's answers plus facts code knows:
 * a required step (not an optional invitation), from the child's own school
 * (not the city or an association), and not already over.
 */
export function isNeedsYou(i: FeedItem): boolean {
  if (i.done || i.own) return false;
  if (i.task) return true;
  // An invitation's state is known exactly (signed up, closed, open): that wins over the model's reading.
  if (i.invite?.data) return false;
  const t = i.triage;
  if (!t || t.needsAction < NEEDS_YOU || t.scope === "wider") return false;
  const now = today();
  const age = daysBetween(dateOf(i.at), now);
  if (t.detail) {
    // Stage 2 named the dates. A passed deadline ends it; so does a passed event day. A past
    // day that isn't an event (the absence being explained) doesn't: that still needs doing.
    if (i.deadline) return i.deadline >= now || age <= 1;
    if (i.eventDate && (t.kind === "event" || t.kind === "schedule")) return i.eventDate >= now || age <= 1;
    return age <= 21;
  }
  if (i.dated && i.upcoming.length === 0 && age > 1) return false; // its dates have passed
  if (!i.dated && age > 14) return false; // undated and old
  return true;
}

export function needsYou(items: FeedItem[]): FeedItem[] {
  return items.filter(isNeedsYou).sort((a, b) => priority(b) - priority(a));
}

/** Nothing to do, but worth knowing soon: tomorrow's later start, a class trip day, from the child's own school. */
export function goodToKnow(items: FeedItem[]): FeedItem[] {
  const now = today();
  return items
    .filter((i) => {
      const t = i.triage;
      if (!t || i.done || isNeedsYou(i) || t.scope === "wider") return false;
      if (daysBetween(dateOf(i.at), now) > 10) return false;
      const day = i.eventDate ?? i.upcoming[0];
      const soon = day !== undefined && day >= now && daysBetween(now, day) <= 2;
      return soon && (t.kind === "event" || t.kind === "schedule" || Boolean(i.eventDate));
    })
    .sort((a, b) => (keyDate(a) ?? "9").localeCompare(keyDate(b) ?? "9"));
}

export function forChildren(items: FeedItem[], selected: string[]): FeedItem[] {
  if (!selected.length) return items;
  return items.filter((i) => i.children.some((c) => selected.includes(c)));
}

export interface AgendaEntry {
  date: string;
  time: string | null;
  child: string;
  kind: "exam" | "event" | "deadline" | "schedule";
  title: string;
  detail: string | null;
  itemKey: string | null;
}

/**
 * What's coming in the next three weeks (or between `range.from` and
 * `range.until`, e.g. one week): exams from Wilma, plus dates in messages Jev
 * says matter.
 */
export function agenda(snap: Snapshot, items: FeedItem[], selected: string[], range?: { from: string; until: string }): AgendaEntry[] {
  const now = range?.from ?? today();
  const until = range?.until ?? addDays(now, 21);
  const entries: AgendaEntry[] = [];
  for (const child of snap.children) {
    if (selected.length && !selected.includes(child.number)) continue;
    for (const exam of snap.perChild[child.number]?.exams ?? []) {
      if (exam.date < now || exam.date > until) continue;
      entries.push({
        date: exam.date,
        time: exam.time ?? null,
        child: child.number,
        kind: "exam",
        title: exam.subject || exam.name,
        detail: exam.topic || exam.name || null,
        itemKey: null,
      });
    }
  }
  for (const item of forChildren(items, selected)) {
    if (item.invite) {
      const { chosen, awaiting, data } = item.invite;
      if (chosen?.start && dateOf(chosen.start) >= now && dateOf(chosen.start) <= until) {
        entries.push({ date: dateOf(chosen.start), time: clock(chosen.start), child: item.children[0], kind: "event", title: item.title, detail: t("Signed up"), itemKey: item.key });
      }
      const deadline = data?.slots.filter((slot) => slotState(slot) === "open" && slot.enrollEnd).map((slot) => slot.enrollEnd!).sort((a, b) => a.getTime() - b.getTime())[0];
      const last = deadline ? deadlineDay(deadline) : null;
      if (awaiting && last && last.day >= now && last.day <= until) {
        entries.push({ date: last.day, time: last.time, child: item.children[0], kind: "deadline", title: t("Sign up: {title}", { title: item.title }), detail: item.from, itemKey: item.key });
      }
      if (data) continue;
    }
    const tri = item.triage;
    if (!tri || item.done || tri.scope === "wider") continue;
    const needs = isNeedsYou(item);
    if (tri.detail) {
      // Stage 2 named the dates: exactly those, no guessing from every date in the text.
      if (needs && item.deadline && item.deadline >= now && item.deadline <= until) {
        entries.push({ date: item.deadline, time: null, child: item.children[0], kind: "deadline", title: item.title, detail: item.actionLine ?? item.from, itemKey: item.key });
      }
      const aboutDay = needs || tri.kind === "event" || tri.kind === "schedule";
      if (aboutDay && item.eventDate && item.eventDate !== item.deadline && item.eventDate >= now && item.eventDate <= until) {
        entries.push({ date: item.eventDate, time: null, child: item.children[0], kind: tri.kind === "schedule" ? "schedule" : "event", title: item.title, detail: item.from, itemKey: item.key });
      }
      continue;
    }
    if (!item.upcoming.length) continue;
    const relevant = needs || tri.kind === "event" || tri.kind === "schedule";
    if (!relevant) continue;
    for (const date of item.upcoming.slice(0, 2)) {
      if (date > until) continue;
      entries.push({
        date,
        time: null,
        child: item.children[0],
        kind: tri.kind === "schedule" ? "schedule" : tri.kind === "event" ? "event" : "deadline",
        title: item.title,
        detail: item.from,
        itemKey: item.key,
      });
    }
  }
  return entries.sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
}

export function childByNumber(snap: Snapshot | null, number: string): Child | undefined {
  return snap?.children.find((c) => c.number === number);
}
