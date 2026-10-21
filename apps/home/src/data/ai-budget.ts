/**
 * Budgets follow the app's recorded OpenAI costs in USD: 50 cents to $3, in 50-cent steps, $1 to start with. A family's
 * month is usually tens of cents; the first month, which also reads the older messages, can come near 50 cents.
 */
export const MIN_AI_BUDGET = 0.5;
export const MAX_AI_BUDGET = 3;
export const AI_BUDGET_STEP = 0.5;
export const DEFAULT_AI_BUDGET = 1;
/** Leave room for calls already in flight. */
export const AI_CALL_MARGIN = 0.01;

export function normalizeAIBudget(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_AI_BUDGET, Math.max(MIN_AI_BUDGET, Math.round(value / AI_BUDGET_STEP) * AI_BUDGET_STEP))
    : DEFAULT_AI_BUDGET;
}

/** A limit as written: "$1", "$0.50", "$2.50". */
export const budgetText = (dollars: number): string => `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;

/** Use the same pause threshold for the request guard and the front-page warning. */
export function aiBudgetState(spent: number, limit: number): "ok" | "near" | "paused" {
  // Token prices can put exact thresholds just below their decimal value in floating point.
  const tolerance = 1e-9;
  if (spent + AI_CALL_MARGIN + tolerance >= limit) return "paused";
  return spent + tolerance >= limit * 0.8 ? "near" : "ok";
}
