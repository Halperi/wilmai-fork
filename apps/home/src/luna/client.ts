/*
 * The app's AI: OpenAI's GPT-6 Luna, with the parent's own key. Two
 * endpoints:
 *  - Responses (/v1/responses): Luna reads a text and answers in a JSON
 *    schema (structured outputs). What it reads is not kept at OpenAI
 *    (store: false).
 *  - Decisions (/v1/decisions): typed questions (predicate, choice, score)
 *    answered with probabilities, as Jev answers.
 * Every call's tokens are counted by month (state.usage), for what it costs,
 * and no call starts that could take the month past the parent's limit,
 * counting what the calls still on their way can cost.
 */
import { bridgeCall } from "../wilma/transport";
import { accountScope, getState, resetScope, setState } from "../data/store";
import type { ReadingUsage, UsageBucket } from "../data/model";
import { t } from "../i18n";
import { intelligenceProvider } from "../data/model";
import { aiBudgetState, budgetText, normalizeAIBudget } from "../data/ai-budget";
import { LOCAL_DECIDER, LOCAL_READER, localDecisions, localReading } from "../ai/config";
import { LocalAIError, decideLocally, readLocally } from "../ai/ollama";

export const LUNA = "gpt-6-luna";
/** How much the reading model reasons unless set: medium read best on the eval suite (8 Oct 2026), for a fraction of a cent a month more than low. */
export const READING_EFFORT = "medium" as const;

/**
 * Models that can read (Responses API), with OpenAI's list prices in dollars
 * per 1M tokens (developers.openai.com/api/docs/pricing, 8 Oct 2026). Luna is
 * the app's; Sol is there to compare on the eval suite.
 */
export const READING_MODELS: Record<string, { label: string; input: number; cached: number; output: number }> = {
  "gpt-6-luna": { label: "GPT-6 Luna", input: 0.1, cached: 0.01, output: 0.5 },
  "gpt-6.1-sol": { label: "GPT-6.1 Sol", input: 2, cached: 0.1, output: 10 },
};

/** Decisions (gpt-6-luna only) bill input only. */
export const DECISIONS_INPUT_PRICE = 0.1;

/** The saved monthly pause limit in USD, including the default for older installations. */
export const monthlyLimit = () => normalizeAIBudget(getState().settings.aiMonthlyBudgetUsd);

/** The usage bucket of this month ("2026-10"), for what it has cost so far. */
export const thisMonth = () => new Date().toISOString().slice(0, 7);

export const readingModel = () => {
  if (localReading(getState().settings)) return getState().settings.localAI?.readingModel ?? LOCAL_READER;
  const m = getState().settings.readingModel;
  return READING_MODELS[m] ? m : LUNA;
};
export const decisionsModel = () => localDecisions(getState().settings) ? getState().settings.localAI?.decisionModel ?? LOCAL_DECIDER : getState().settings.decisionsModel ?? LUNA;

async function localCall<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (e) { throw new LunaError(e instanceof Error ? e.message : String(e), e instanceof LocalAIError ? e.retryable : true); }
}

export class LunaError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "LunaError";
  }
}

const emptyReading = (): ReadingUsage => ({ calls: 0, input: 0, cached: 0, output: 0, reasoning: 0 });
const emptyBucket = (): UsageBucket => ({ reading: {}, decisions: { calls: 0, input: 0, estimated: false }, items: 0 });
const addReading = (a: ReadingUsage, b: ReadingUsage): ReadingUsage => ({
  calls: a.calls + b.calls,
  input: a.input + b.input,
  cached: a.cached + b.cached,
  output: a.output + b.output,
  reasoning: a.reasoning + b.reasoning,
});

/** A month's reading by model (a month before models could be chosen read with Luna). */
export function readingOf(b: UsageBucket): Record<string, ReadingUsage> {
  const out = { ...(b.reading ?? {}) };
  if (b.responses) out[LUNA] = out[LUNA] ? addReading(out[LUNA], b.responses) : b.responses;
  return out;
}

/** All of a month's reading, whatever the model (for showing tokens). */
export const readingTotal = (b: UsageBucket): ReadingUsage => Object.values(readingOf(b)).reduce(addReading, emptyReading());

const month = thisMonth;

function count(update: (b: UsageBucket) => UsageBucket) {
  setState((s) => ({ usage: { ...s.usage, [month()]: update(s.usage[month()] ?? emptyBucket()) } }));
}

/** One more message, bulletin or note read (for the cost per item). */
export function countItem() {
  if (localReading(getState().settings)) return;
  count((b) => ({ ...b, items: b.items + 1 }));
}

/** What a month's (or all months') use costs at the list prices, in dollars. */
export function costOf(b: UsageBucket): number {
  let dollars = (b.decisions.input * DECISIONS_INPUT_PRICE) / 1e6;
  for (const [model, r] of Object.entries(readingOf(b))) {
    const price = READING_MODELS[model] ?? READING_MODELS[LUNA];
    dollars += ((r.input - r.cached) * price.input + r.cached * price.cached + r.output * price.output) / 1e6;
  }
  return dollars;
}

export function totalUsage(usage: Record<string, UsageBucket>): UsageBucket {
  return Object.values(usage).reduce((a, b) => {
    const reading = { ...readingOf(a) };
    for (const [model, r] of Object.entries(readingOf(b))) reading[model] = reading[model] ? addReading(reading[model], r) : r;
    return {
      reading,
      decisions: { calls: a.decisions.calls + b.decisions.calls, input: a.decisions.input + b.decisions.input, estimated: a.decisions.estimated || b.decisions.estimated },
      items: a.items + b.items,
    };
  }, emptyBucket());
}

/** This month's cost so far, at the list prices (as counted on this computer). */
export function monthCost(): number {
  const b = getState().usage[thisMonth()];
  return b ? costOf(b) : 0;
}

/** The first day of next month, when the limit starts over ("2026-11-01"). */
export function nextMonth(): string {
  const [y, m] = thisMonth().split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** At most what the calls on their way to OpenAI cost, in dollars: it counts against the limit until their usage is counted. */
let reserved = 0;

/** Reasoning a call can use at each effort, in tokens, for its most cost. */
const REASONING_CEILING = { none: 0, low: 2_000, medium: 4_000, high: 10_000 } as const;

/** At most what a Responses call costs, about: its input at three characters a token, as much again out, and its reasoning. */
function responsesCeiling(model: string, chars: number, effort: keyof typeof REASONING_CEILING): number {
  const price = READING_MODELS[model] ?? READING_MODELS[LUNA];
  const input = chars / 3;
  return (input * price.input + (input + REASONING_CEILING[effort]) * price.output) / 1e6;
}

/** Counts a call's most cost against the limit until it's done and its usage is counted. */
async function reserving<T>(ceiling: number, work: () => Promise<T>): Promise<T> {
  reserved += ceiling;
  try {
    return await work();
  } finally {
    reserved -= ceiling;
  }
}

/** The month has reached the limit, with what the calls on their way can cost: no more calls until next month. */
export const overLimit = () => aiBudgetState(monthCost() + reserved, monthlyLimit()) === "paused";

/*
 * A network that can't reach OpenAI (a school or work network that blocks it, or no connection): calls stop at the
 * first sign of it, with one clear message, and AI waits a few minutes before one quick check (App.tsx), or until
 * Check again. A block page or a proxy's error isn't OpenAI's answer: it doesn't carry OpenAI's own headers.
 */
export const OPENAI_PAUSE_MS = 5 * 60_000;

export const openAIBlockedMessage = () => t("OpenAI can't be reached from this network, so AI is paused. It tries again in a few minutes, or check again in Settings.");

/** OpenAI was unreachable a moment ago: no calls yet. */
export const openAIPaused = () => {
  const blocked = getState().openaiBlocked;
  return Boolean(blocked && Date.now() - blocked.at < OPENAI_PAUSE_MS);
};

function blocked(reason: "network" | "intercepted", detail: string | null): LunaError {
  setState({ openaiBlocked: { at: Date.now(), reason, detail } });
  return new LunaError(openAIBlockedMessage(), false);
}

type Reach = { reachable: boolean; reason: "network" | "intercepted" | null; detail: string | null };
let reaching: Promise<Reach> | null = null;

/** Can this computer reach OpenAI at all (no key needed)? Clears the pause when it can. */
export function openAIReach(): Promise<Reach> {
  reaching ??= (async () => {
    const r = await bridgeCall<Reach>("openai-reach").catch((err: unknown) => ({ reachable: false, reason: "network" as const, detail: err instanceof Error ? err.message : String(err) }));
    setState({ openaiBlocked: r.reachable ? null : { at: Date.now(), reason: r.reason ?? "network", detail: r.detail } });
    return r;
  })().finally(() => {
    reaching = null;
  });
  return reaching;
}

/** Before a run: false while OpenAI is unreachable. Once the pause is over, one quick check decides. */
export async function openAIReady(): Promise<boolean> {
  const blocked = getState().openaiBlocked;
  if (!blocked) return true;
  if (Date.now() - blocked.at < OPENAI_PAUSE_MS) return false;
  return (await openAIReach()).reachable;
}

async function post(path: "/v1/responses" | "/v1/decisions", body: unknown): Promise<unknown> {
  const scope = accountScope();
  if (intelligenceProvider(getState().settings) !== "openai") throw new LunaError(t("OpenAI isn't chosen in Settings."), false);
  const key = getState().settings.openaiKey.trim();
  if (!key) throw new LunaError(t("Add an OpenAI API key in Settings."), false);
  if (openAIPaused()) throw new LunaError(openAIBlockedMessage(), false);
  for (let attempt = 1; ; attempt += 1) {
    if (scope !== accountScope()) throw new LunaError("Account changed", false);
    if (overLimit()) throw new LunaError(t("WilmAI Intelligence has reached this month's limit of {limit}. It starts again next month.", { limit: budgetText(monthlyLimit()) }), false);
    let r: { status: number; retryAfter: string | null; body: string; fromOpenai?: boolean };
    try {
      r = await bridgeCall<typeof r>("openai", { body, headers: { "x-openai-key": key, "x-openai-path": path } });
    } catch (err) {
      throw blocked("network", (err instanceof Error ? err.message : String(err)).replace(/^Couldn't reach OpenAI: /, ""));
    }
    if (r.fromOpenai === false) throw blocked("intercepted", `HTTP ${r.status}`);
    if (getState().openaiBlocked) setState({ openaiBlocked: null });
    if (r.status === 200) return JSON.parse(r.body);
    const message = (() => {
      try {
        return (JSON.parse(r.body) as { error?: { message?: string } }).error?.message ?? null;
      } catch {
        return null;
      }
    })();
    if (r.status === 401 || r.status === 403) throw new LunaError(t("OpenAI didn't accept the API key."), false);
    const retryable = r.status === 429 || r.status >= 500;
    if (!retryable || attempt >= 4) throw new LunaError(message ? `OpenAI ${r.status}: ${message}` : t("OpenAI answered HTTP {status}.", { status: r.status }), retryable);
    const wait = Number(r.retryAfter) > 0 ? Math.min(Number(r.retryAfter) * 1000, 30_000) : 500 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

interface ResponsesReply {
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } };
}

/** The reading model reads `input` and answers in `schema` (strict structured outputs). */
export async function respond<T>(opts: { name: string; instructions: string; input: string; schema: Record<string, unknown>; effort?: "none" | "low" | "medium" | "high"; model?: string }): Promise<T> {
  if (localReading(getState().settings)) return localCall(() => readLocally<T>(opts));
  const generation = resetScope();
  const model = opts.model && READING_MODELS[opts.model] ? opts.model : readingModel();
  const effort = opts.effort ?? getState().settings.readingEffort ?? READING_EFFORT;
  const ceiling = responsesCeiling(model, opts.instructions.length + opts.input.length + JSON.stringify(opts.schema).length, effort);
  const data = await reserving(ceiling, async () => {
    const reply = (await post("/v1/responses", {
      model,
      instructions: opts.instructions,
      input: opts.input,
      reasoning: { effort },
      text: { format: { type: "json_schema", name: opts.name, strict: true, schema: opts.schema } },
      store: false,
    })) as ResponsesReply;
    const u = reply.usage ?? {};
    const used: ReadingUsage = {
      calls: 1,
      input: u.input_tokens ?? 0,
      cached: u.input_tokens_details?.cached_tokens ?? 0,
      output: u.output_tokens ?? 0,
      reasoning: u.output_tokens_details?.reasoning_tokens ?? 0,
    };
    if (generation === resetScope()) count((b) => {
      const reading = readingOf(b);
      return { ...b, responses: undefined, reading: { ...reading, [model]: reading[model] ? addReading(reading[model], used) : used } };
    });
    return reply;
  });
  const parts = (data.output ?? []).flatMap((o) => o.content ?? []);
  const refusal = parts.find((c) => c.type === "refusal");
  if (refusal) throw new LunaError(t("The AI didn't answer: {why}", { why: refusal.refusal ?? "" }), false);
  const text = parts.find((c) => c.type === "output_text")?.text;
  if (!text) throw new LunaError(t("The AI's answer was empty."), true);
  return JSON.parse(text) as T;
}

export type DecisionQuestion =
  | { type: "predicate"; name: string; instructions: string }
  | { type: "choice"; name: string; instructions: string; choices: { value: string; description: string }[] }
  | { type: "score"; name: string; instructions: string; levels: { label: string; description: string }[] };

export type DecisionAnswer =
  | { type: "predicate"; name: string; probability: number }
  | { type: "choice"; name: string; choice: string; probabilities: { value: string; probability: number }[]; confidence: number }
  | { type: "score"; name: string; score: number; probabilities: { value: number; label: string; probability: number }[]; confidence: number }
  | { type: "refusal"; name: string };

/** Typed questions about `input`, answered with probabilities (Luna's Decisions endpoint). */
export async function decide(input: string, questions: DecisionQuestion[]): Promise<Record<string, DecisionAnswer>> {
  if (localDecisions(getState().settings)) return localCall(() => decideLocally(input, questions));
  const generation = resetScope();
  const body = { model: getState().settings.decisionsModel || LUNA, input, questions };
  // Input only, at three characters a token at most.
  const ceiling = ((JSON.stringify(body).length / 3) * DECISIONS_INPUT_PRICE) / 1e6;
  const data = await reserving(ceiling, async () => {
    const reply = (await post("/v1/decisions", body)) as { answers?: DecisionAnswer[]; usage?: { input_tokens?: number } };
    // The guide shows no usage in the answer; until one comes, about four characters a token.
    const measured = reply.usage?.input_tokens;
    if (generation === resetScope()) count((b) => ({
      ...b,
      decisions: { calls: b.decisions.calls + 1, input: b.decisions.input + (measured ?? Math.ceil(JSON.stringify(body).length / 4)), estimated: b.decisions.estimated || measured === undefined },
    }));
    return reply;
  });
  const answers = Object.fromEntries((data.answers ?? []).map((a) => [a.name, a]));
  for (const q of questions) if (!answers[q.name]) throw new LunaError(t("The AI's answer was missing a question"), true);
  return answers;
}
