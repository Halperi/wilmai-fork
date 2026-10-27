import { setNow } from "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { aiBudgetState, budgetText, normalizeAIBudget } from "../src/data/ai-budget.ts";
import { DEFAULT_SETTINGS, type UsageBucket } from "../src/data/model.ts";
import { getState, setState, updateSettings } from "../src/data/store.ts";
import { decide, monthCost, monthlyLimit, overLimit, respond } from "../src/luna/client.ts";
import { overrideBridge } from "../src/wilma/transport.ts";

const questions = [{ type: "predicate" as const, name: "needed", instructions: "Does this need a response?" }];
const usage = (dollars: number): UsageBucket => ({ items: 1, decisions: { calls: 1, input: dollars * 1e7, estimated: false } });
const reply = { status: 200, retryAfter: null, body: JSON.stringify({ usage: { input_tokens: 0 }, answers: [{ type: "predicate", name: "needed", probability: 0.9 }] }) };

function setup(spent: number, limit?: number) {
  setNow(Date.parse("2026-10-09T12:00:00Z"));
  setState({ settings: { ...DEFAULT_SETTINGS, aiProvider: "openai", openaiKey: "synthetic-budget-test-key", aiMonthlyBudgetUsd: limit }, usage: { "2026-10": usage(spent), "2026-09": usage(50) } });
}

test("older settings default to $1 and invalid budgets cannot bypass the $0.50–$3 range", () => {
  assert.equal(DEFAULT_SETTINGS.aiMonthlyBudgetUsd, 1);
  for (const value of [undefined, null, "5", NaN, Infinity]) assert.equal(normalizeAIBudget(value), 1);
  assert.equal(normalizeAIBudget(-10), 0.5);
  assert.equal(normalizeAIBudget(10), 3);
  assert.equal(normalizeAIBudget(5), 3, "a $5 limit saved before keeps the new highest");
  assert.equal(normalizeAIBudget(2.7), 2.5);
  assert.equal(normalizeAIBudget(0.74), 0.5);
  assert.deepEqual([0.5, 1, 2.5, 3].map(budgetText), ["$0.50", "$1", "$2.50", "$3"]);
  setup(0);
  assert.equal(monthlyLimit(), 1);
});

test("warnings start exactly at 80% and use the same pause threshold for every slider value", () => {
  for (const limit of [0.5, 1, 1.5, 2, 2.5, 3]) {
    assert.equal(aiBudgetState(limit * 0.8 - 0.001, limit), "ok");
    assert.equal(aiBudgetState(Number((limit * 0.8).toFixed(2)), limit), "near");
    assert.equal(aiBudgetState(limit - 0.011, limit), "near");
    assert.equal(aiBudgetState(limit - 0.01, limit), "paused");
    assert.equal(aiBudgetState(limit, limit), "paused");
  }
});

test("budget adjustments are persisted and update the request guard immediately", async () => {
  setup(1.6, 2);
  let sent = 0;
  overrideBridge(async () => { sent++; return reply; });
  try {
    await decide("Please reply", questions);
    assert.equal(sent, 1);
    updateSettings({ aiMonthlyBudgetUsd: 1 });
    assert.equal(JSON.parse(localStorage.getItem("wilmai.settings")!).aiMonthlyBudgetUsd, 1);
    assert.equal(overLimit(), true);
    await assert.rejects(decide("Please reply", questions), /limit of \$1/);
    assert.equal(sent, 1, "lowering the budget prevents a new API request");
    updateSettings({ aiMonthlyBudgetUsd: 3 });
    assert.equal(JSON.parse(localStorage.getItem("wilmai.settings")!).aiMonthlyBudgetUsd, 3);
    assert.equal(overLimit(), false);
    await decide("Please reply", questions);
    assert.equal(sent, 2, "raising the budget allows waiting work");
    updateSettings({ aiMonthlyBudgetUsd: 99 });
    assert.equal(getState().settings.aiMonthlyBudgetUsd, 3);
  } finally { overrideBridge(null); }
});

test("the default limit blocks calls near $1 and resets with the next month", async () => {
  setup(0.99);
  let sent = 0;
  overrideBridge(async () => { sent++; return reply; });
  try {
    assert.ok(Math.abs(monthCost() - 0.99) < 1e-9);
    await assert.rejects(decide("Please reply", questions), /limit of \$1\./);
    assert.equal(sent, 0);
    setNow(Date.parse("2026-11-01T12:00:00Z"));
    assert.equal(monthCost(), 0);
    assert.equal(overLimit(), false);
    await decide("Please reply", questions);
    assert.equal(sent, 1);
  } finally { overrideBridge(null); }
});

test("a retry checks the current budget before sending another request", async () => {
  setup(1.2, 2);
  let sent = 0;
  overrideBridge(async () => {
    sent++;
    updateSettings({ aiMonthlyBudgetUsd: 1 });
    return { status: 429, retryAfter: "0.001", body: "{}" };
  });
  try {
    await assert.rejects(decide("Please reply", questions), /limit of \$1/);
    assert.equal(sent, 1);
  } finally { overrideBridge(null); }
});

test("calls on their way count against the limit, so parallel calls can't take the month past it", async () => {
  setup(0.88);
  let sent = 0;
  const waiting: (() => void)[] = [];
  let hold = true;
  const answer = { status: 200, retryAfter: null, body: JSON.stringify({ usage: { input_tokens: 10, output_tokens: 10 }, output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }] }) };
  overrideBridge(async () => {
    sent++;
    if (hold) await new Promise<void>((resolve) => waiting.push(resolve));
    return answer;
  });
  // A batch of about 6,000 characters for Sol at low effort: at most about 4.4 cents a call.
  const call = () => respond({ name: "phrases", instructions: "Translate.", input: "x".repeat(6000), schema: { type: "object" }, effort: "low", model: "gpt-6.1-sol" });
  try {
    const calls = [call(), call()];
    await assert.rejects(call(), /limit of \$1/, "a third call at once could take the month past $1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(sent, 2);
    hold = false;
    for (const resolve of waiting) resolve();
    await Promise.all(calls);
    assert.ok(monthCost() < 0.89, "what they cost is counted, and their reservations are released");
    await call();
    assert.equal(sent, 3);
  } finally { overrideBridge(null); }
});
