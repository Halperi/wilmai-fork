/*
 * What an exam's mark means. Wilma's "Arvosana" column is free text: school
 * grades, but also points ("24" with the note "Pisteet /25p.", "21,5/24"),
 * other scales ("4" with "Arviointi 1-5"), letters (K, H, T), "poissa", and
 * whatever else a school writes. Jev reads each mark with the exam's name and
 * the teacher's note (questions.ts, markQuestions): what kind of mark it is
 * and how good on its own scale; the maximum of points or a scale is read
 * from the text (luna/marks.ts). Code only does arithmetic: the value of a
 * school grade ("8+" 8.25) and the share of points out of their maximum.
 *
 * Without Jev's answer (no key, or not read yet) a mark that looks like a
 * school grade counts as one, and anything else is shown as written.
 * Only school grades go into averages, trends and lines; the rest is shown
 * shaded by how good Jev read it to be.
 */
import type { PastExam } from "@wilma-client/src/core";
import type { JevRecord } from "./model";
import { MARK_LEVELS, MARK_QS } from "../jev/questions";

export interface ExamMark {
  kind: "grade" | "points" | "scale" | "letter" | "pass" | "absent" | "other";
  /** On the 4–10 school scale (school grades only): for averages, trends and lines. */
  value: number | null;
  /** 0–1 of the best possible, as Jev read it (points, other scales, letters): for the shade. */
  share: number | null;
  /** As shown: "9½", "24/25", "4/5", "K", "poissa". */
  text: string;
  /** Jev has read this mark. */
  read: boolean;
}

/** A school grade's value: "9" 9, "8+" 8.25, "9-" 8.75, "9½"/"9,5"/"9.5"/"9 1/2" 9.5; null when it isn't written like one. */
export function schoolGrade(text: string): number | null {
  const m = /^\s*(10|[4-9])\s*(½|,5|\.5|\s1\/2|\+|-)?\s*$/.exec(text);
  if (!m) return null;
  const base = Number(m[1]);
  const mark = m[2]?.trim();
  return mark === "+" ? base + 0.25 : mark === "-" ? base - 0.25 : mark ? base + 0.5 : base;
}

/** The key Jev's reading of an exam's mark is kept under. */
export const markKey = (resultKey: string) => `x:${resultKey}`;

const best = (answer: JevRecord["answers"][string] | undefined, floor = 0.5): string | null =>
  answer?.type === "choice" && answer.confidence >= floor ? answer.choice : null;

/** How good, from Jev's level answer: the levels weighed by their probabilities (not "can't tell"). */
function shareOf(record: JevRecord): number | null {
  const a = record.answers.level;
  if (a?.type !== "choice") return null;
  let sum = 0;
  let weight = 0;
  for (const [level, p] of Object.entries(a.probabilities)) {
    const share = MARK_LEVELS[level]?.share;
    if (share === undefined) continue;
    sum += share * p;
    weight += p;
  }
  return weight >= 0.5 ? sum / weight : null;
}

export function examMark(exam: Pick<PastExam, "grade" | "info" | "name">, record?: JevRecord): ExamMark {
  const text = (exam.grade ?? "").replace(/\s+/g, " ").trim();
  const asWritten = (kind: ExamMark["kind"] = "other", share: number | null = null, read = false): ExamMark => ({ kind, value: null, share, text, read });
  if (!text) return asWritten();
  if (!record || record.qs !== MARK_QS) {
    const value = schoolGrade(text);
    return value !== null ? { kind: "grade", value, share: null, text, read: false } : asWritten();
  }

  const share = shareOf(record);
  switch (best(record.answers.kind)) {
    case "school_grade": {
      const value = schoolGrade(text);
      return value !== null ? { kind: "grade", value, share: null, text, read: true } : asWritten("other", share, true);
    }
    case "points":
    case "other_scale": {
      // The maximum as read from the mark, the name and the note (luna/marks.ts).
      const of = record.meta?.maximum ?? null;
      // "24" and maximum 25 → "24/25"; "8/10 pistettä" → "8/10".
      const bare = text.replace(/\s*(pistettä|pistettä\.|pist\.?|p\.?)$/i, "");
      const shown = of && !bare.includes("/") && /^\d+(?:[,.]\d+)?$/.test(bare) ? `${bare}/${of}` : bare;
      // Out of its maximum ("21,5/24", or "24" and the maximum read): the share is arithmetic; else the decisions' "how good".
      const frac = /^(\d+(?:[,.]\d+)?)\s*\/\s*(\d+(?:[,.]\d+)?)$/.exec(shown);
      const got = frac ? Number(frac[1].replace(",", ".")) : NaN;
      const outOf = frac ? Number(frac[2].replace(",", ".")) : NaN;
      const counted = outOf > 0 && got >= 0 ? Math.min(1, got / outOf) : share;
      return { kind: best(record.answers.kind) === "points" ? "points" : "scale", value: null, share: counted, text: shown, read: true };
    }
    case "letter":
      return asWritten("letter", share, true);
    case "pass_fail":
      return asWritten("pass", share, true);
    case "no_result":
      return asWritten("absent", null, true);
    default:
      return asWritten("other", share, true);
  }
}

/** The shade for a mark: g10 deepest green … g4 red, from the grade or its share of the best; "other" when unknown. */
export function markShade(mark: ExamMark): string {
  if (mark.value !== null) return `g${Math.max(4, Math.min(10, Math.round(mark.value)))}`;
  if (mark.share !== null) {
    const s = mark.share;
    return s >= 0.95 ? "g10" : s >= 0.85 ? "g9" : s >= 0.75 ? "g8" : s >= 0.65 ? "g7" : s >= 0.55 ? "g6" : s >= 0.45 ? "g5" : "g4";
  }
  return "other";
}
