/*
 * The maximum of an exam mark that is points or another scale ("24" with the
 * note "Pisteet /25p.", "4" with "Arviointi 1-5"): read by the reading model
 * from the mark, the exam's name and the teacher's note, not picked among
 * numbers code found. Code keeps it only when that number is written there.
 */
import type { PastExam } from "@wilma-client/src/core";
import { respond } from "./client";

const INSTRUCTIONS = `You read one exam mark from Wilma, the Finnish school system: the mark as written, the exam's name and the teacher's note.
The mark is points or a number on a scale. Give its maximum: the most points there were, or the top of the scale, as the number is written in the mark, the name or the note ("25" for "Pisteet /25p.", "5" for "Arviointi 1-5", "24" for "21,5/24").
No maximum written anywhere: null. Don't guess one.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["maximum"],
  properties: { maximum: { type: ["string", "null"], description: "The maximum, as written (digits, a decimal comma allowed)" } },
};

/** The numbers written in a text ("21,5", "24"), to check the model's answer against. */
const numbersIn = (text: string) => new Set(text.match(/\d+(?:[,.]\d+)?/g) ?? []);

export async function readMaximum(exam: Pick<PastExam, "grade" | "name" | "info" | "subject">): Promise<string | null> {
  const input = [`Mark: ${exam.grade ?? ""}`, `Exam: ${exam.name || "-"} (${exam.subject})`, `Teacher's note: ${exam.info ?? "-"}`].join("\n");
  const { maximum } = await respond<{ maximum: string | null }>({ name: "mark_maximum", instructions: INSTRUCTIONS, input, schema: SCHEMA, effort: "low" });
  const written = numbersIn(`${exam.grade ?? ""}\n${exam.name ?? ""}\n${exam.info ?? ""}`);
  return maximum && written.has(maximum.trim()) ? maximum.trim() : null;
}
