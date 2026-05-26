import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStandardActionPlan,
  buildErrorAdviceText,
  buildStandardOperatorSummary,
  buildStandardNextStepAdvice,
  normalizeErrorKey,
  pickScenarioIdsForPack,
  validateProfileConfig,
} from "../src/operator-guidance.js";

test("operator guidance maps common API errors to user-facing advice", () => {
  assert.equal(normalizeErrorKey("API Error: Content block not found"), "content_block_not_found");
  assert.equal(normalizeErrorKey("request timeout after 60000ms"), "timeout");
  assert.equal(normalizeErrorKey({ normalizedError: "auth_failed" }), "auth_failed");

  const advice = buildErrorAdviceText("Content block not found");
  assert.match(advice, /内容块缺失/);
  assert.match(advice, /协议/);
});

test("operator guidance selects scenario packs by category", () => {
  const scenarios = [
    { id: "a", category: "connectivity" },
    { id: "b", category: "speed" },
    { id: "c", category: "structured" },
    { id: "d", category: "coding" },
    { id: "e", category: "long_context" },
    { id: "f", category: "safety" },
  ];

  assert.deepEqual(pickScenarioIdsForPack(scenarios, "scenario-small"), ["a", "b", "c"]);
  assert.deepEqual(pickScenarioIdsForPack(scenarios, "scenario-coding"), ["d"]);
  assert.deepEqual(pickScenarioIdsForPack(scenarios, "scenario-safety"), ["f"]);
  assert.deepEqual(pickScenarioIdsForPack(scenarios, "scenario-basic"), ["a", "b", "c", "d", "e"]);
});

test("operator guidance recommends next step after standard evaluation", () => {
  const passAdvice = buildStandardNextStepAdvice({
    quick: { success: true },
    stability: { successRate: 1, p95TotalMs: 1200 },
    scenario: { results: [{ avgQualityScore: 80 }] },
  });
  assert.match(passAdvice.join("\n"), /复制交付模板/);

  const failAdvice = buildStandardNextStepAdvice({
    quick: { success: false },
    stability: null,
    scenario: null,
  });
  assert.match(failAdvice.join("\n"), /不要继续消耗 token/);
});

test("operator guidance validates API profile configuration before save", () => {
  const invalid = validateProfileConfig({
    baseUrl: "https://api.example.com/v1/chat/completions",
    protocol: "openai_compatible",
    defaultModel: "demo-model",
    timeoutMs: "60000",
    maxTokens: "512",
  });
  assert.equal(invalid.hasBlockers, true);
  assert.match(invalid.issues[0].detail, /不要带/);

  const warning = validateProfileConfig({
    baseUrl: "https://api.anthropic.com",
    protocol: "openai_compatible",
    defaultModel: "claude-sonnet-4-5",
    timeoutMs: "10000",
    maxTokens: "64",
  });
  assert.equal(warning.hasWarnings, true);
  assert.equal(warning.hasBlockers, false);
});

test("operator guidance builds plain-language summary and action buttons", () => {
  const summary = buildStandardOperatorSummary({
    quick: { success: true },
    stability: { successRate: 1, p95TotalMs: 1000 },
    scenario: { results: [{ avgQualityScore: 85 }] },
  });
  assert.equal(summary.level, "pass");
  assert.match(summary.title, /初筛通过/);
  assert.match(summary.detail, /复制交付模板/);

  const passActions = buildStandardActionPlan({
    quick: { success: true },
    stability: { successRate: 1, p95TotalMs: 1000 },
    scenario: { results: [{ avgQualityScore: 85 }] },
  });
  assert.deepEqual(
    passActions.map((action) => action.action),
    ["handoff", "stability-basic", "scenario-basic"],
  );
  assert.equal(passActions[0].kind, "primary");

  const actions = buildStandardActionPlan({
    quick: { success: false },
    stability: null,
    scenario: null,
  });
  assert.deepEqual(
    actions.map((action) => action.action),
    ["profile-config", "quick-retry"],
  );
});
