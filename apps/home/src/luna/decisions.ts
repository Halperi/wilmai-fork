/*
 * Jev's questions, answered by the selected local or cloud decision model.
 * The question sets stay as they are (src/jev/questions.ts);
 * this only translates: Jev's state (an object) becomes text, a noul question
 * a predicate with its yes and no spelled out, a choice's criteria its
 * choices' descriptions; the answers come back in Jev's shape, so the rest of
 * the app reads them as before.
 */
import type { JevAnswer } from "../data/model";
import type { Entry, Question } from "../jev/questions";
import { decisionsModel, decide, type DecisionQuestion } from "./client";

/** An Entry as plain text: objects as indented "key: value" lines, lists as "- " lines. */
export function entryText(entry: Entry, indent = ""): string {
  if (entry === null) return "none";
  if (typeof entry !== "object") return String(entry);
  if (Array.isArray(entry)) return entry.map((e) => (typeof e === "object" && e !== null ? `${indent}-\n${entryText(e, `${indent}  `)}` : `${indent}- ${entryText(e)}`)).join("\n");
  return Object.entries(entry)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => (typeof v === "object" && v !== null ? `${indent}${k}:\n${entryText(v, `${indent}  `)}` : `${indent}${k}: ${entryText(v)}`))
    .join("\n");
}

/** One line for a choice's description ("what: …; not for: …"). */
const oneLine = (entry: Entry) => entryText(entry).replace(/\n\s*/g, "; ");

function toDecision(name: string, q: Question): DecisionQuestion {
  const instructions = entryText(q.instructions);
  if (q.type === "noul") {
    const yes = q.criteria?.true !== undefined ? `\nYes: ${oneLine(q.criteria.true)}` : "";
    const no = q.criteria?.false !== undefined ? `\nNo: ${oneLine(q.criteria.false)}` : "";
    return { type: "predicate", name, instructions: `${instructions}${yes}${no}` };
  }
  if (q.type === "choice") return { type: "choice", name, instructions, choices: Object.entries(q.criteria).map(([value, what]) => ({ value, description: oneLine(what) })) };
  return { type: "score", name, instructions, levels: q.criteria.map((what, i) => ({ label: String(i), description: oneLine(what) })) };
}

function toJev(q: Question, a: Awaited<ReturnType<typeof decide>>[string]): JevAnswer {
  if (a.type === "predicate") return { type: "noul", noul: a.probability };
  if (a.type === "choice") return { type: "choice", choice: a.choice, probabilities: Object.fromEntries(a.probabilities.map((p) => [p.value, p.probability])), confidence: a.confidence };
  if (a.type === "score") return { type: "score", score: a.score, probabilities: Object.fromEntries(a.probabilities.map((p) => [String(p.value), p.probability])), confidence: a.confidence };
  // A refusal reads as the neutral answer, not sure of anything: the first choice (the neutral one), no, the lowest level.
  if (q.type === "choice") {
    const first = Object.keys(q.criteria)[0];
    return { type: "choice", choice: first, probabilities: { [first]: 0 }, confidence: 0 };
  }
  if (q.type === "score") return { type: "score", score: 0, probabilities: {}, confidence: 0 };
  return { type: "noul", noul: 0 };
}

/** Jev's questions about `state`, answered by the selected model in Jev's shape. */
export async function askDecisions(state: Entry, questions: Record<string, Question>): Promise<{ model: string; answers: Record<string, JevAnswer> }> {
  const answers = await decide(entryText(state), Object.entries(questions).map(([name, q]) => toDecision(name, q)));
  return { model: decisionsModel(), answers: Object.fromEntries(Object.entries(questions).map(([name, q]) => [name, toJev(q, answers[name])])) };
}
