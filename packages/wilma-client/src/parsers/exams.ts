import * as cheerio from "cheerio";
import type { Exam, PastExam, UpcomingExam } from "../types.js";
import { htmlToText } from "./html-text.js";

export function parseExamsHtml(html: string): Exam[] {
  const $ = cheerio.load(html);
  const exams: Exam[] = [];
  let autoId = 1;
  const now = new Date();

  $("div.table-responsive.margin-bottom").each((_, block) => {
    const table = $(block).find("table.table-grey").first();
    if (!table.length) {
      return;
    }

    const rows = table.find("tr");
    if (!rows.length) {
      return;
    }

    const firstCells = $(rows.get(0)).find("td");
    if (firstCells.length < 2) {
      return;
    }

    const dateText = $(firstCells.get(0)).text().trim();
    const match = /(\d{1,2}\.\d{1,2}\.\d{4})/.exec(dateText);
    if (!match) {
      return;
    }

    const [d, m, y] = match[1].split(".").map(Number);
    // Use midday UTC to avoid timezone date shifts in JSON output
    const examDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    // Also store as local date string to avoid any serialization issues
    const dateString = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    // "Pe 30.10.2026 Klo 08:30": some exams have a start time.
    const timeMatch = /klo\s*(\d{1,2})[:.](\d{2})/i.exec(dateText);
    const time = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : null;

    // Compact whitespace first to normalize the text before parsing
    const subjDesc = compactText($(firstCells.get(1)).text());
    let subject = subjDesc;
    let description: string | null = null;
    if (subjDesc.includes(":")) {
      const parts = subjDesc.split(":");
      description = parts[0].trim();
      subject = parts.slice(1).join(":").trim();
    }

    let teacher: string | null = null;
    let notes: string | null = null;

    rows.slice(1).each((_, row) => {
      const th = $(row).find("th").first();
      const td = $(row).find("td").first();
      if (!th.length || !td.length) {
        return;
      }
      const header = th.text().trim().toLowerCase();
      const value = td.text().trim();
      if (header.includes("opettaja")) {
        const names = td
          .find("a.profile-link")
          .toArray()
          .map((a) => $(a).text().trim())
          .filter(Boolean);
        teacher = names.length ? names.join(", ") : value;
      } else if (header.includes("lisätiedot") || header.includes("notes")) {
        notes = value;
      }
    });

    exams.push({
      wilmaId: autoId,
      examDate,
      dateString,
      subject: compactText(subject || "(N/A)"),
      description: description ? compactText(description) : null,
      teacher: teacher ? compactText(teacher) : null,
      notes: notes ? compactText(notes) : null,
      time,
      fetchedAt: now,
    });

    autoId += 1;
  });

  return exams;
}

/**
 * Wilma's past exams page (Kokeet > Menneet): a table with a row per exam,
 * columns seen, date, teachers, exam, notes, grade and verbal assessment. The
 * exam cell reads "name : group course-code : course title", e.g.
 * "Verbikoe 4 : RUB1_ Ruotsin kieli, B1.t RUB1_91 : Ruotsin kieli, B1".
 * Columns are found by their headings (Finnish, Swedish or English), or by
 * Wilma's usual order. Newest first.
 */
export function parsePastExamsHtml(html: string): PastExam[] {
  const $ = cheerio.load(html);
  const table = $("table#examtable").first().length ? $("table#examtable").first() : $("main table").first();
  if (!table.length) return [];

  const headings = table.find("tr").first().find("th").toArray().map((th) => $(th).text().trim().toLowerCase());
  const column = (pattern: RegExp, fallback: number) => {
    const at = headings.findIndex((h) => pattern.test(h));
    return at >= 0 ? at : fallback;
  };
  const col = {
    seen: column(/nähty|sedd|seen/, 0),
    date: column(/^pvm|päivä|datum|date/, 1),
    teacher: column(/opettaja|lärare|teacher/, 2),
    exam: column(/^(koe|prov|exam)$/, 3),
    info: column(/lisätied|tilläggs|additional|info/, 4),
    grade: column(/^(arvosana|vitsord|grade)$/, 5),
    verbal: column(/sanallinen|verbal/, 6),
  };

  const isoDate = (text: string): string | null => {
    const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text);
    return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
  };

  const exams: PastExam[] = [];
  table.find("tr").each((_, row) => {
    const cells = $(row).children("td").toArray();
    if (cells.length < 6) return;
    const cell = (i: number) => (cells[i] ? $(cells[i]) : null);
    const date = isoDate(cell(col.date)?.text() ?? "");
    if (!date) return;

    const { name, subject, subjectCode } = splitPastExamTitle(compactText(cell(col.exam)?.text() ?? ""));
    const links = (cell(col.teacher)?.find("a.profile-link").toArray() ?? []).map((a) => $(a));
    const teacherText = compactText(cell(col.teacher)?.text() ?? "");
    const grade = compactText(cell(col.grade)?.text() ?? "");
    const info = htmlToText(cell(col.info)?.html());
    const verbal = htmlToText(cell(col.verbal)?.html());

    exams.push({
      date,
      name,
      subject,
      subjectCode,
      grade: grade || null,
      verbalGrade: verbal || null,
      info: info || null,
      teacher: links.length ? links.map((a) => compactText(a.attr("title") || a.text())).join(", ") : teacherText,
      teacherCode: links.length ? links.map((a) => compactText(a.text())).join(", ") : "",
      seen: isoDate(cell(col.seen)?.text() ?? ""),
    });
  });

  // Newest first; the order Wilma gave within a day.
  return exams.map((exam, i) => ({ exam, i })).sort((a, b) => b.exam.date.localeCompare(a.exam.date) || a.i - b.i).map((x) => x.exam);
}

const COURSE_CODE = /^[\p{Lu}\d]+_[\p{L}\d]*$/u;

/** "RUB1_ Ruotsin kieli, B1.t RUB1_91": a group and its course, ending in the course code; that code, else null. */
function courseCodeOf(part: string): string | null {
  const words = part.trim().split(/\s+/);
  return words.length >= 2 && COURSE_CODE.test(words[0]) && COURSE_CODE.test(words[words.length - 1]) ? words[words.length - 1] : null;
}

/**
 * "Name : GROUP_ Group title CODE_91 : Course title" → its name, course title
 * and code. Without a name Wilma writes only "GROUP_ Group title CODE_91 :
 * Course title"; without a course, "Name : Course title".
 */
function splitPastExamTitle(text: string): { name: string; subject: string; subjectCode: string } {
  const parts = text.split(" : ");
  if (parts.length >= 3) {
    const middle = parts[parts.length - 2].trim().split(/\s+/);
    const last = middle[middle.length - 1] ?? "";
    return {
      name: parts.slice(0, -2).join(" : ").trim(),
      subject: parts[parts.length - 1].trim(),
      subjectCode: COURSE_CODE.test(last) ? last : "",
    };
  }
  if (parts.length === 2) {
    const code = courseCodeOf(parts[0]);
    return code ? { name: "", subject: parts[1].trim(), subjectCode: code } : { name: parts[0].trim(), subject: parts[1].trim(), subjectCode: "" };
  }
  return { name: text, subject: "", subjectCode: "" };
}

/**
 * Add start times from the exam calendar to upcoming exams (the front page's
 * exam list has dates only). An exam is matched by date and its course code
 * (e.g. "MA_91" appears in the calendar entry), or by date alone when it is
 * the only exam that day in both lists.
 */
export function addExamTimes(upcoming: UpcomingExam[], calendar: Exam[]): UpcomingExam[] {
  return upcoming.map((exam) => {
    const sameDay = calendar.filter((entry) => entry.dateString === exam.date);
    const code = exam.subjectCode ? new RegExp(`(^|\\s)${escapeRegExp(exam.subjectCode)}(\\s|$|[.,:])`) : null;
    const text = (entry: Exam) => `${entry.description ?? ""} ${entry.subject}`;
    let byCode = code ? sameDay.filter((entry) => code.test(text(entry))) : [];
    if (byCode.length > 1) {
      // Several exams of one course that day: the exam's name tells them apart.
      const nameWords = words(exam.name);
      const scored = byCode.map((entry) => {
        const entryWords = new Set(words(text(entry)));
        return { entry, score: nameWords.filter((word) => entryWords.has(word)).length };
      });
      const best = Math.max(...scored.map((s) => s.score));
      byCode = best > 0 ? scored.filter((s) => s.score === best).map((s) => s.entry) : byCode;
    }
    const onlyOne = sameDay.length === 1 && upcoming.filter((other) => other.date === exam.date).length === 1;
    const match = byCode.length === 1 ? byCode[0] : onlyOne ? sameDay[0] : null;
    return { ...exam, time: match?.time ?? null };
  });
}

function words(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\d]{3,}/gu) ?? [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
