// server/live-adapters.mjs
//
// LLM 裁判 / RUT 的「真实采样」适配器（v2.0 wiring #3/#4 真实激活，安全建设）。
//
// 编排层（judge-orchestration / rut-orchestration）对采样全用依赖注入：
//   - 裁判：callJudge(judgeModel, prompt) => Promise<文本>
//   - RUT：sampleTarget(prompt) / sampleBaseline(prompt) => Promise<record>
// 这里提供把这些注入点接到真实请求机（executeTestRequest）的适配器。
//
// **安全设计**：
//   1. runRequest 仍是依赖注入参数（默认 executeTestRequest），测试可注入 mock，
//      本模块自身不强制发任何真实请求 —— 单测零额度消耗。
//   2. 真实跑由上层显式构造适配器并提供「裁判/基线 profile + 额度上限」才会发生；
//      默认 env 开关关闭（见 isLiveJudgeEnabled / isLiveRutEnabled）。
//   3. 上线顺序遵循：纯透传 → 审计(只记录) → shadow → 小流量 → 阻断。
//      首次真实跑应停在「审计」：跑并记录裁判/RUT 结论，但不据此改变任何对外结论。

import { executeTestRequest } from "./test-runner.mjs";

// env 闸门：默认关闭。真实激活需显式置 1，且仍受额度守卫约束。
export function isLiveJudgeEnabled() {
  return process.env.NEXUSAPI_ENABLE_LIVE_JUDGE === "1";
}
export function isLiveRutEnabled() {
  return process.env.NEXUSAPI_ENABLE_LIVE_RUT === "1";
}

// 裁判调用器：judges 传裁判 profile 列表；callJudge 收到的是“裁判模型名”
// （编排层用模型名做同家族规避），按模型名映射回 profile 再发请求。
// runRequest 默认 executeTestRequest，可注入 mock 测试。
export function createJudgeCaller(judgeProfiles = [], { runRequest = executeTestRequest, runId = "llm-judge", abortSignal = null } = {}) {
  const byModel = new Map();
  for (const profile of judgeProfiles) {
    if (profile?.defaultModel && !byModel.has(profile.defaultModel)) {
      byModel.set(profile.defaultModel, profile);
    }
  }
  return async function callJudge(judgeModel, prompt) {
    const profile = byModel.get(judgeModel);
    if (!profile) return ""; // 找不到对应裁判渠道 → 空文本（编排层会跳过该裁判）
    const record = await runRequest(profile, prompt, {
      runId,
      caseId: "llm-judge",
      writeLog: true,
      abortSignal,
    });
    return record?.success ? record.responseText || "" : "";
  };
}

// 裁判模型名列表（喂给 runMultiJudge 的 judges，用于同家族规避）。
export function judgeModelsFromProfiles(judgeProfiles = []) {
  return judgeProfiles.map((p) => p?.defaultModel).filter(Boolean);
}

// RUT 采样器：给定 profile，返回 sample(prompt) => Promise<record>。
// scoreResponse 默认读 record.responseText（textLengthScore 兼容）。
export function createProfileSampler(profile, { runRequest = executeTestRequest, runId = "rut", caseId = "rut", abortSignal = null } = {}) {
  if (!profile) throw new Error("createProfileSampler 需要一个 profile");
  return async function sample(prompt) {
    return runRequest(profile, prompt, { runId, caseId, writeLog: true, abortSignal });
  };
}
