import { formatNumber } from "./client-utils.js";

const TOKEN_ESTIMATES = {
  short: [80, 200],
  normal: [300, 800],
  coding: [1000, 3000],
  longContext: [4000, 10000],
  reasoning: [800, 2000],
  safety: [300, 900],
};

export function estimateStabilityCost(payload) {
  const requests = Number(payload.rounds || 10);
  return withAiAnalysisEstimate(payload, {
    requests,
    lowTokens: requests * TOKEN_ESTIMATES.short[0],
    highTokens: requests * TOKEN_ESTIMATES.short[1],
    risk: requests >= 30 ? "中高" : requests >= 10 ? "中" : "低",
    note: "稳定性测试使用短 Prompt，主要看成功率、延迟和错误分布。",
  });
}

export function estimateStandardCost(payload, scenarioCount = 2) {
  const rounds = Number(payload.rounds || 3);
  const requests = 1 + rounds + scenarioCount;
  const estimate = {
    requests,
    lowTokens: TOKEN_ESTIMATES.short[0] + rounds * TOKEN_ESTIMATES.short[0] + scenarioCount * TOKEN_ESTIMATES.normal[0],
    highTokens: TOKEN_ESTIMATES.short[1] + rounds * TOKEN_ESTIMATES.short[1] + scenarioCount * TOKEN_ESTIMATES.normal[1],
    risk: rounds >= 10 ? "中" : "低",
    note: "标准评测会依次执行快速测试、稳定性测试和少量场景测试，适合初筛。",
  };
  return withAiAnalysisEstimate(payload, estimate, scenarioCount > 0 ? 2 : 1);
}


export function estimateBatchCost(payload) {
  const profiles = payload.profileIds?.length || 0;
  const rounds = Number(payload.rounds || 10);
  const requests = profiles * rounds;
  return withAiAnalysisEstimate(payload, {
    requests,
    lowTokens: requests * TOKEN_ESTIMATES.short[0],
    highTokens: requests * TOKEN_ESTIMATES.short[1],
    risk: requests >= 100 ? "高" : requests >= 30 ? "中" : "低",
    note: "批量测试会按 API 数量成倍增加请求数。建议先跑 3 轮筛查。",
  });
}

export function estimateScenarioCost(payload, scenarios) {
  const profiles = payload.profileIds?.length || 0;
  const repeats = Number(payload.repeats || 1);
  const selectedIds = payload.scenarioIds || [];
  const selectedScenarios = scenarios.filter((scenario) => selectedIds.includes(scenario.id));
  const perRun = selectedScenarios.reduce((total, scenario) => total + highTokenEstimateForScenario(scenario), 0);
  const lowPerRun = selectedScenarios.reduce((total, scenario) => total + lowTokenEstimateForScenario(scenario), 0);
  const requests = profiles * selectedScenarios.length * repeats;
  return withAiAnalysisEstimate(payload, {
    requests,
    lowTokens: profiles * repeats * lowPerRun,
    highTokens: profiles * repeats * perRun,
    risk: profiles * repeats * perRun >= 100000 ? "高" : profiles * repeats * perRun >= 20000 ? "中高" : "中",
    note: "场景测试包含代码和长上下文，token 消耗可能明显高于稳定性测试。",
  });
}

export function formatEstimate(estimate) {
  const guide = costGuideForRisk(estimate.risk);
  return [
    `大概花费：${guide.title}`,
    `建议：${guide.action}`,
    `会发起 ${estimate.requests} 次请求，预计消耗 ${formatNumber(estimate.lowTokens)} - ${formatNumber(estimate.highTokens)} tokens。`,
    `说明：${estimate.note}`,
    `技术参考：成本等级 ${estimate.risk}。`,
  ].join("\n");
}

export function confirmExecution(title, estimate) {
  return {
    title: `准备执行：${title}`,
    message: formatEstimate(estimate),
    detail: "这次测试会消耗额度。确认后会立即开始请求 API。",
    confirmLabel: "确认开始测试",
    cancelLabel: "先不运行",
    tone: estimate.risk === "高" || estimate.risk === "中高" ? "danger" : "normal",
  };
}

function costGuideForRisk(risk) {
  if (risk === "高" || risk === "中高") {
    return {
      title: "偏高，先别直接大批量跑",
      action: "建议先问负责人，或把轮数、API 数量、场景数量降下来。",
    };
  }
  if (risk === "中") {
    return {
      title: "中等，适合确认后运行",
      action: "如果只是日常复测可以跑；如果 Key 额度紧张，先跑 3 轮。",
    };
  }
  return {
    title: "较低，适合先跑一轮",
    action: "可以放心用于初筛；失败后不要继续跑更贵的测试。",
  };
}

function withAiAnalysisEstimate(payload, estimate, analysisRequests = 1) {
  if (!isAiAnalysisChecked(payload)) {
    return estimate;
  }
  const extraLowTokens = analysisRequests * 800;
  const extraHighTokens = analysisRequests * 1800;
  return {
    ...estimate,
    requests: estimate.requests + analysisRequests,
    lowTokens: estimate.lowTokens + extraLowTokens,
    highTokens: estimate.highTokens + extraHighTokens,
    risk: upgradeRisk(estimate.risk, extraHighTokens),
    note: `${estimate.note} 已勾选 AI 分析，会额外调用 ${analysisRequests} 次当前 API/模型生成报告解读。`,
  };
}

function isAiAnalysisChecked(payload) {
  return payload?.useAiReportAnalysis === "1" || payload?.useAiReportAnalysis === "on" || payload?.useAiReportAnalysis === true;
}

function upgradeRisk(risk, extraHighTokens) {
  if (extraHighTokens >= 3000 && risk === "低") return "中";
  return risk;
}

function highTokenEstimateForScenario(scenario) {
  if (scenario.category === "long_context") return TOKEN_ESTIMATES.longContext[1];
  if (scenario.category === "coding") return TOKEN_ESTIMATES.coding[1];
  if (scenario.category === "reasoning") return TOKEN_ESTIMATES.reasoning[1];
  if (scenario.category === "safety") return TOKEN_ESTIMATES.safety[1];
  if (scenario.difficulty === "normal") return TOKEN_ESTIMATES.normal[1];
  return TOKEN_ESTIMATES.short[1];
}

function lowTokenEstimateForScenario(scenario) {
  if (scenario.category === "long_context") return TOKEN_ESTIMATES.longContext[0];
  if (scenario.category === "coding") return TOKEN_ESTIMATES.coding[0];
  if (scenario.category === "reasoning") return TOKEN_ESTIMATES.reasoning[0];
  if (scenario.category === "safety") return TOKEN_ESTIMATES.safety[0];
  if (scenario.difficulty === "normal") return TOKEN_ESTIMATES.normal[0];
  return TOKEN_ESTIMATES.short[0];
}
