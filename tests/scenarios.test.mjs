import assert from "node:assert/strict";
import test from "node:test";

test("scenario registry includes safety scenarios by default", async () => {
  delete process.env.NEXUSAPI_ENABLE_SAFETY_SCENARIOS;
  const { TEST_SCENARIOS } = await import(`../server/scenarios/index.mjs?case=default-${Date.now()}`);

  assert.ok(TEST_SCENARIOS.some((scenario) => scenario.category === "safety"));
  assert.ok(TEST_SCENARIOS.some((scenario) => scenario.category === "coding"));
});

test("scenario registry can hide safety scenarios for ordinary packaging", async () => {
  process.env.NEXUSAPI_ENABLE_SAFETY_SCENARIOS = "0";
  const { TEST_SCENARIOS } = await import(`../server/scenarios/index.mjs?case=disabled-${Date.now()}`);

  assert.equal(TEST_SCENARIOS.some((scenario) => scenario.category === "safety"), false);
  assert.ok(TEST_SCENARIOS.some((scenario) => scenario.category === "coding"));
  delete process.env.NEXUSAPI_ENABLE_SAFETY_SCENARIOS;
});
