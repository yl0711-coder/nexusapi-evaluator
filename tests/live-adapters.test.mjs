import assert from "node:assert/strict";
import test from "node:test";

import {
  createJudgeCaller,
  createProfileSampler,
  judgeModelsFromProfiles,
  isLiveJudgeEnabled,
  isLiveRutEnabled,
} from "../server/live-adapters.mjs";
import { runMultiJudge } from "../server/judge-orchestration.mjs";
import { runRutAudit, textLengthScore } from "../server/rut-orchestration.mjs";

// mock 请求机：记录被调用，返回可控 record。零真实请求。
function makeMockRunner(responder) {
  const calls = [];
  const run = async (profile, prompt, options) => {
    calls.push({ profile, prompt, options });
    return responder(profile, prompt, options);
  };
  return { run, calls };
}

test("live activation flags default to off", () => {
  // 默认 env 不带开关 → 关闭，绝不擅自发真实请求
  assert.equal(isLiveJudgeEnabled(), process.env.NEXUSAPI_ENABLE_LIVE_JUDGE === "1");
  assert.equal(isLiveRutEnabled(), process.env.NEXUSAPI_ENABLE_LIVE_RUT === "1");
});

test("judgeModelsFromProfiles extracts model names for family-conflict avoidance", () => {
  const models = judgeModelsFromProfiles([
    { id: "j1", defaultModel: "gpt-4.1" },
    { id: "j2", defaultModel: "claude-sonnet-4-5" },
    { id: "j3" }, // 无 model → 被过滤
  ]);
  assert.deepEqual(models, ["gpt-4.1", "claude-sonnet-4-5"]);
});

test("createJudgeCaller maps judge model name back to its profile and returns text", async () => {
  const judges = [
    { id: "j1", name: "裁判A", defaultModel: "gpt-4.1" },
    { id: "j2", name: "裁判B", defaultModel: "claude-sonnet-4-5" },
  ];
  const { run, calls } = makeMockRunner((profile) => ({
    success: true,
    responseText: `评分：${profile.id === "j1" ? 80 : 90}`,
  }));
  const callJudge = createJudgeCaller(judges, { runRequest: run });

  const a = await callJudge("gpt-4.1", "prompt");
  const b = await callJudge("claude-sonnet-4-5", "prompt");
  assert.equal(a, "评分：80");
  assert.equal(b, "评分：90");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].profile.id, "j1");
  assert.equal(calls[0].options.caseId, "llm-judge");
});

test("createJudgeCaller returns empty for unknown model or failed request", async () => {
  const judges = [{ id: "j1", defaultModel: "gpt-4.1" }];
  const { run } = makeMockRunner(() => ({ success: false, responseText: "boom" }));
  const callJudge = createJudgeCaller(judges, { runRequest: run });
  assert.equal(await callJudge("unknown-model", "p"), ""); // 找不到渠道
  assert.equal(await callJudge("gpt-4.1", "p"), ""); // 请求失败 → 空
});

test("createJudgeCaller composes with runMultiJudge end-to-end (mocked requests)", async () => {
  const judges = [
    { id: "j1", defaultModel: "gpt-4.1" },
    { id: "j2", defaultModel: "gemini-1.5-pro" },
  ];
  const { run } = makeMockRunner((profile) => ({
    success: true,
    responseText: `评分：${profile.id === "j1" ? 70 : 76}`,
  }));
  const callJudge = createJudgeCaller(judges, { runRequest: run });
  const result = await runMultiJudge({
    judges: judgeModelsFromProfiles(judges),
    targetModel: "claude-sonnet-4-5", // 与两个裁判都不同家族 → 都可用
    question: "Q",
    answer: "A",
    callJudge,
  });
  assert.equal(result.ok, true);
  assert.equal(result.perJudge.length, 2);
  assert.equal(result.needsHumanReview, false);
  assert.ok(result.mean >= 70 && result.mean <= 76);
});

test("createProfileSampler drives runRutAudit with mocked sampling (zero real calls)", async () => {
  const target = { id: "t1", defaultModel: "myst-model" };
  const baseline = { id: "b1", defaultModel: "trusted-base" };
  const { run, calls } = makeMockRunner((profile) => ({
    success: true,
    responseText: profile.id === "t1" ? "x".repeat(40) : "x".repeat(42),
  }));
  const sampleTarget = createProfileSampler(target, { runRequest: run });
  const sampleBaseline = createProfileSampler(baseline, { runRequest: run });

  const out = await runRutAudit({
    prompts: ["p1", "p2"],
    sampleTarget,
    sampleBaseline,
    scoreResponse: textLengthScore,
    baselineSamples: 3,
    maxCalls: 100,
  });
  assert.equal(out.allowed, true);
  // 2 prompts × (1 target + 3 baseline) = 8 calls
  assert.equal(out.callsUsed, 8);
  assert.equal(calls.length, 8);
  assert.ok(out.audit);
});

test("runRutAudit blocks (zero calls) when over budget", async () => {
  const target = { id: "t1", defaultModel: "m" };
  const baseline = { id: "b1", defaultModel: "b" };
  const { run, calls } = makeMockRunner(() => ({ success: true, responseText: "x" }));
  const out = await runRutAudit({
    prompts: Array.from({ length: 100 }, (_, i) => `p${i}`),
    sampleTarget: createProfileSampler(target, { runRequest: run }),
    sampleBaseline: createProfileSampler(baseline, { runRequest: run }),
    baselineSamples: 100,
    maxCalls: 50, // 100×101 远超 50 → 阻断
  });
  assert.equal(out.allowed, false);
  assert.equal(out.callsUsed, 0);
  assert.equal(calls.length, 0, "超预算时一个请求都不发");
});
