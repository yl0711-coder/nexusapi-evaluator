import { BASIC_SCENARIOS } from "./basic.mjs";
import { CODING_SCENARIOS } from "./coding.mjs";
import { LONG_CONTEXT_SCENARIOS } from "./long-context.mjs";
import { SAFETY_SCENARIOS } from "./safety.mjs";

export const ABILITY_SCENARIOS = [
  ...BASIC_SCENARIOS,
  ...CODING_SCENARIOS,
  ...LONG_CONTEXT_SCENARIOS,
];

export const TEST_SCENARIOS = [
  ...ABILITY_SCENARIOS,
  ...enabledSafetyScenarios(),
];

function enabledSafetyScenarios() {
  return process.env.NEXUSAPI_ENABLE_SAFETY_SCENARIOS === "0" ? [] : SAFETY_SCENARIOS;
}
