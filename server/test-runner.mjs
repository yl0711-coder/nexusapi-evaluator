import crypto from "node:crypto";
import {
  buildAiAnalysisResult,
  buildAiReportAnalysisPrompt,
  isAiReportAnalysisEnabled,
} from "./ai-report-analysis.mjs";
import { TEST_SCENARIOS } from "./scenarios/index.mjs";
import { REQUEST_LOG_FILE, TEST_RUNS_FILE } from "./paths.mjs";
import { loadProfiles } from "./profile-store.mjs";
import { evaluateScenarioOutput } from "./scenario-evaluator.mjs";
import { readProfileApiKey } from "./secret-store.mjs";
import {
  buildFingerprintProbeCases,
  buildFingerprintProbeSummary,
  buildPurityAssessment,
  buildTokenAudit,
  evaluateFingerprintProbe,
  inferModelFamily,
  normalizeModelFamily,
} from "./model-fingerprint.mjs";
import {
  buildProtocolRequest,
  buildProtocolStreamRequest,
  buildProtocolToolRequest,
  extractOutputText,
  extractToolCall,
  extractUsage,
  normalizeEmptyResponse,
  normalizeHttpError,
  summarizeStreamStructure,
} from "./protocols.mjs";
import { estimateProfileRunEconomics } from "./costing.mjs";
import {
  countErrors,
  formatAdmissionReport,
  formatBatchAdmissionReport,
  formatBatchReport,
  formatScenarioReport,
  formatStabilityReport,
  saveReportFiles,
} from "./reporting.mjs";
import { buildScenarioProfileSummary, buildScenarioSummary, buildStabilitySummary } from "./summaries.mjs";
import { recordRequest } from "./db.mjs";
import { assertTaskNotCancelled, updateTaskProgress } from "./task-manager.mjs";
import {
  appendJsonLine,
  clampNumber,
  compactDate,
  mean,
  parseLooseJson,
  percentile,
  safeJson,
  summarizeText,
  sumNullable,
} from "./utils.mjs";
import { saveRunArtifacts } from "./workspace-store.mjs";

const MAX_UPSTREAM_RESPONSE_BYTES = 2 * 1024 * 1024;

// Owns all real upstream evaluation work. server.mjs should route requests here
// instead of carrying test execution details in the HTTP entrypoint.
async function attachRunArtifacts(runId, summary, artifacts = {}) {
  const files = await saveRunArtifacts(runId, {
    summary,
    ...artifacts,
  });
  return {
    ...summary,
    ...files,
  };
}

export async function runQuickTest(profileId, prompt) {
  const profiles = await loadProfiles();
  const profile = profiles.find((item) => item.id === profileId);
  if (!profile) {
    return {
      success: false,
      normalizedError: "profile_not_found",
      message: "没有找到被测 API 配置。",
    };
  }

  return executeTestRequest(profile, prompt, {
    runId: "quick-test",
    caseId: "quick-connectivity",
    writeLog: true,
  });
}

export async function runAdmissionTest(body) {
  const profiles = await loadProfiles();
  const profile = profiles.find((item) => item.id === body.profileId);
  if (!profile) {
    throw new Error("没有找到被测 API 配置。");
  }

  const packageLevel = ["quick", "standard", "deep"].includes(body.packageLevel)
    ? body.packageLevel
    : "standard";
  const runId = `admission-${compactDate(new Date())}-${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = new Date();
  const cases = buildAdmissionCases(packageLevel, profile.defaultModel);
  const records = [];

  for (const testCase of cases) {
    const record = await executeAdmissionTestCase(profile, testCase, runId);
    const admission = evaluateAdmissionCase(testCase, record);
    delete record.responseText;
    records.push({
      ...record,
      caseName: testCase.name,
      admission,
    });
  }

  const endedAt = new Date();
  let summary = buildAdmissionSummary({
    runId,
    profile,
    records,
    packageLevel,
    startedAt,
    endedAt,
  });
  summary = await attachRunArtifacts(runId, summary, { records });
  const reportMarkdown = formatAdmissionReport(summary, records);
  const reportFiles = await saveReportFiles(runId, reportMarkdown, "NexusAPI 模型准入评测报告");

  await appendJsonLine(TEST_RUNS_FILE, {
    ...summary,
    type: "admission",
    reportPath: reportFiles.markdownPath,
    reportHtmlPath: reportFiles.htmlPath,
    rawJsonPath: summary.rawJsonPath,
    workspaceDir: summary.workspaceDir,
    reportMarkdown: undefined,
  });

  return {
    ...summary,
    type: "admission",
    reportPath: reportFiles.markdownPath,
    reportHtmlPath: reportFiles.htmlPath,
    rawJsonPath: summary.rawJsonPath,
    workspaceDir: summary.workspaceDir,
    reportMarkdown,
  };
}

export async function runBatchAdmissionTest(body, taskContext = {}) {
  const profiles = await loadProfiles();
  const profileIds = normalizeProfileIds(body.profileIds);
  if (profileIds.length === 0) {
    throw new Error("请至少选择一个被测 API。");
  }

  const existingIds = new Set(profiles.map((profile) => profile.id));
  const validProfileIds = profileIds.filter((profileId) => existingIds.has(profileId));
  if (validProfileIds.length === 0) {
    throw new Error("没有找到可用的被测 API 配置。");
  }

  const packageLevel = ["quick", "standard", "deep"].includes(body.packageLevel)
    ? body.packageLevel
    : "standard";
  const maxParallelProfiles = clampNumber(body.maxParallelProfiles, 1, 3, 1);
  const batchId = `admission-batch-${compactDate(new Date())}-${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = new Date();
  const results = [];

  for (let index = 0; index < validProfileIds.length; index += maxParallelProfiles) {
    assertTaskNotCancelled(taskContext);
    const batch = validProfileIds.slice(index, index + maxParallelProfiles);
    const settled = await Promise.allSettled(
      batch.map((profileId) =>
        runAdmissionTest({
          ...body,
          profileId,
          packageLevel,
        }),
      ),
    );
    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(stripHeavyRunResult(result.value));
      } else {
        results.push({
          success: false,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
    updateTaskProgress(
      taskContext,
      results.length,
      validProfileIds.length,
      `批量准入评测进行中：${results.length}/${validProfileIds.length} 个 API`,
    );
  }

  const endedAt = new Date();
  let summary = {
    batchId,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    profileCount: validProfileIds.length,
    packageLevel,
    maxParallelProfiles,
    results,
  };
  summary = await attachRunArtifacts(batchId, summary, { results });
  const reportMarkdown = formatBatchAdmissionReport(summary);
  const reportFiles = await saveReportFiles(batchId, reportMarkdown, "NexusAPI 批量准入评测报告");

  await appendJsonLine(TEST_RUNS_FILE, {
    ...summary,
    type: "batch-admission",
    reportPath: reportFiles.markdownPath,
    reportHtmlPath: reportFiles.htmlPath,
    rawJsonPath: summary.rawJsonPath,
    workspaceDir: summary.workspaceDir,
    reportMarkdown: undefined,
  });

  return {
    ...summary,
    type: "batch-admission",
    reportPath: reportFiles.markdownPath,
    reportHtmlPath: reportFiles.htmlPath,
    rawJsonPath: summary.rawJsonPath,
    workspaceDir: summary.workspaceDir,
    reportMarkdown,
  };
}

export async function runStabilityTest(body, taskContext = {}) {
  const profiles = await loadProfiles();
  const profile = profiles.find((item) => item.id === body.profileId);
  if (!profile) {
    throw new Error("没有找到被测 API 配置。");
  }

  return runStabilityForProfile({
    profile,
    body,
    taskContext,
    onProgress: (completed, total) => {
      updateTaskProgress(taskContext, completed, total, `稳定性测试进行中：${completed}/${total} 轮`);
    },
  });
}

function buildAdmissionCases(packageLevel, modelName = "") {
  const cases = [
    {
      id: "connectivity",
      name: "连通与模型响应",
      prompt: "请只回复一句：NexusAPI admission ok",
    },
    {
      id: "json_structure",
      name: "结构化输出",
      prompt: [
        "请严格返回 JSON，不要使用 Markdown。",
        "字段必须包含 channelReady、modelType、risk。",
        "channelReady 为 true，modelType 填当前模型类型的简短判断，risk 填 low。",
      ].join("\n"),
    },
    {
      id: "model_identity",
      name: "模型标称一致性",
      prompt: [
        "请严格返回 JSON，不要使用 Markdown。",
        "字段必须包含 modelFamily、modelGeneration、confidence、evidence。",
        "modelFamily 只能填写 claude、openai、gemini、deepseek、glm、doubao、kimi、grok、unknown 之一。",
        "请根据你当前可见的模型标识和能力边界回答；如果无法确认，请填写 unknown，不要编造。",
      ].join("\n"),
    },
    {
      id: "tool_call",
      name: "工具调用结构",
      kind: "tool",
    },
    {
      id: "stream_structure",
      name: "流式响应结构",
      kind: "stream",
      prompt: "请用一句话说明流式响应正常。",
    },
  ];

  if (packageLevel === "standard" || packageLevel === "deep") {
    cases.push(
      {
        id: "coding_small",
        name: "小型编程任务",
        prompt: [
          "下面这段 JavaScript 有一个明显问题，请说明问题并给出修复后的代码。",
          "",
          "function add(a, b) {",
          "  return a + b",
          "}",
          "console.log(add('1', 2))",
          "",
          "要求：简洁回答，必须包含修复后的代码。",
        ].join("\n"),
      },
      {
        id: "behavior_reasoning",
        name: "渠道行为解释",
        prompt: "用 4 点说明为什么同一个模型在不同 API 渠道上可能出现速度、稳定性和输出结构差异。要求具体、专业、不要泛泛而谈。",
      },
      ...buildFingerprintProbeCases({ modelName }),
    );
  }

  if (packageLevel === "deep") {
    cases.push({
      id: "long_context_light",
      name: "轻量长上下文",
      prompt: [
        "请阅读以下规则片段并输出 5 条可执行检查项。",
        "规则：接入 API 渠道前，需要确认协议类型、模型名、工具调用、流式响应、token 用量、超时表现、错误码归因、成本倍率和复测记录。",
        "请按“检查项 / 通过标准 / 失败处理”三列输出。",
      ].join("\n"),
    });
  }

  return cases;
}

async function executeAdmissionTestCase(profile, testCase, runId) {
  const baseOptions = {
    runId,
    caseId: testCase.id,
    caseName: testCase.name,
    writeLog: true,
  };

  if (testCase.kind === "tool") {
    return executeToolCallTestRequest(profile, baseOptions);
  }
  if (testCase.kind === "stream") {
    return executeStreamStructureTestRequest(profile, testCase.prompt, baseOptions);
  }
  return executeTestRequest(profile, testCase.prompt, baseOptions);
}

function evaluateAdmissionCase(testCase, record) {
  if (testCase.kind === "tool") {
    const passed = record.success && record.toolCall?.name === "get_weather";
    return {
      passed,
      issue: passed ? "工具调用结构正常。" : record.rawError || "没有返回期望的工具调用结构。",
    };
  }

  if (testCase.kind === "stream") {
    const passed = Boolean(record.success && record.streamValidation?.passed);
    const issues = record.streamValidation?.issues || [];
    return {
      passed,
      issue: passed ? "流式响应结构完整。" : issues.length ? `流式结构异常：${issues.join(", ")}` : record.rawError || "流式结构未通过。",
    };
  }

  if (!record.success) {
    return {
      passed: false,
      issue: record.normalizedError || record.rawError || "请求失败。",
    };
  }

  const text = String(record.responseSummary || "");
  if (testCase.id === "json_structure") {
    const parsed = parseLooseJson(record.responseText || record.responseSummary);
    const passed = Boolean(parsed && Object.hasOwn(parsed, "channelReady") && parsed.modelType && parsed.risk);
    return {
      passed,
      issue: passed ? "结构化 JSON 字段完整。" : "没有返回可解析且字段完整的 JSON。",
    };
  }
  if (testCase.id === "model_identity") {
    const parsed = parseLooseJson(record.responseText || record.responseSummary);
    const identityCheck = evaluateModelIdentity(record.model, parsed, record.responseText || record.responseSummary);
    return {
      passed: identityCheck.status !== "conflict",
      issue: identityIssueText(identityCheck),
      identityCheck,
    };
  }
  if (testCase.id === "coding_small") {
    const passed = /function|const|let|return|Number|parseInt|parseFloat|修复|代码/i.test(text) && text.length >= 50;
    return {
      passed,
      issue: passed ? "编程小任务有有效回答。" : "编程回答过短或缺少修复代码。",
    };
  }
  if (testCase.id === "behavior_reasoning") {
    const passed = /(渠道|模型|协议|延迟|稳定|路由|缓存|限流)/.test(text) && text.length >= 80;
    return {
      passed,
      issue: passed ? "行为解释具备基本专业性。" : "解释过短或缺少渠道评测关键点。",
    };
  }
  if (testCase.id === "long_context_light") {
    const passed = /(检查项|通过标准|失败处理|协议|模型|token|超时)/i.test(text) && text.length >= 120;
    return {
      passed,
      issue: passed ? "轻量长上下文任务完成。" : "长上下文检查项不完整。",
    };
  }
  if (testCase.id.startsWith("fingerprint_")) {
    return evaluateFingerprintProbe(testCase, record.responseText || record.responseSummary);
  }

  return {
    passed: true,
    issue: "请求正常返回。",
  };
}

function evaluateModelIdentity(modelName, parsed, rawText) {
  const expectedFamily = inferModelFamily(modelName);
  const reportedFamily = normalizeModelFamily(parsed?.modelFamily || parsed?.family || parsed?.provider || rawText);
  const confidence = String(parsed?.confidence || "").trim().toLowerCase();
  const evidence = summarizeText(parsed?.evidence || parsed?.notes || rawText || "");

  if (!expectedFamily) {
    return {
      status: reportedFamily ? "observed" : "unknown",
      expectedFamily: "unknown",
      reportedFamily: reportedFamily || "unknown",
      confidence,
      evidence,
    };
  }

  if (!reportedFamily || reportedFamily === "unknown") {
    return {
      status: "unknown",
      expectedFamily,
      reportedFamily: "unknown",
      confidence,
      evidence,
    };
  }

  if (reportedFamily !== expectedFamily) {
    return {
      status: "conflict",
      expectedFamily,
      reportedFamily,
      confidence,
      evidence,
    };
  }

  return {
    status: "aligned",
    expectedFamily,
    reportedFamily,
    confidence,
    evidence,
  };
}

function identityIssueText(identityCheck) {
  if (identityCheck.status === "aligned") {
    return `模型自述与标称家族一致：${identityCheck.expectedFamily}。`;
  }
  if (identityCheck.status === "conflict") {
    return `模型自述与标称家族冲突：标称 ${identityCheck.expectedFamily}，自述 ${identityCheck.reportedFamily}。`;
  }
  if (identityCheck.status === "observed") {
    return `模型标称家族无法从模型名判断，自述为 ${identityCheck.reportedFamily}。`;
  }
  return `模型没有明确自述家族，标称 ${identityCheck.expectedFamily}，需结合后续测试判断。`;
}

function buildAdmissionSummary({ runId, profile, records, packageLevel, startedAt, endedAt }) {
  const requestCount = records.length;
  const successCount = records.filter((record) => record.success).length;
  const passedCount = records.filter((record) => record.admission?.passed).length;
  const successRate = requestCount ? successCount / requestCount : 0;
  const passRate = requestCount ? passedCount / requestCount : 0;
  const errorCounts = countErrors(records.filter((record) => !record.success));
  const avgTotalMs = mean(records.map((record) => record.totalMs)) ?? null;
  const p95TotalMs = percentile(records.map((record) => record.totalMs), 0.95);
  const inputTokens = sumNullable(records.map((record) => record.inputTokens));
  const outputTokens = sumNullable(records.map((record) => record.outputTokens));
  const tokenCoverage = records.filter((record) => record.inputTokens !== null || record.outputTokens !== null).length / Math.max(1, requestCount);
  const jsonPassed = Boolean(records.find((record) => record.caseId === "json_structure")?.admission?.passed);
  const toolCallPassed = Boolean(records.find((record) => record.caseId === "tool_call")?.admission?.passed);
  const streamPassed = Boolean(records.find((record) => record.caseId === "stream_structure")?.admission?.passed);
  const identityRecord = records.find((record) => record.caseId === "model_identity");
  const identityCheck = identityRecord?.admission?.identityCheck || null;
  const identityPassed = Boolean(identityRecord?.admission?.passed);
  const codingPassed = records
    .filter((record) => ["coding_small", "behavior_reasoning", "long_context_light"].includes(record.caseId))
    .every((record) => record.admission?.passed);
  const severeError = Object.keys(errorCounts).find((code) =>
    ["auth_failed", "model_not_found", "content_block_not_found", "upstream_5xx"].includes(code),
  );
  const identityPenalty = identityCheck?.status === "conflict" ? 15 : identityCheck?.status === "unknown" ? 3 : 0;
  const latencyPenalty = p95TotalMs && p95TotalMs > 45000 ? 10 : p95TotalMs && p95TotalMs > 15000 ? 5 : 0;
  const tokenAudit = buildTokenAudit(records);
  const fingerprintSummary = buildFingerprintProbeSummary(records);
  const economics = estimateProfileRunEconomics(profile, { inputTokens, outputTokens });
  const purityAssessment = buildPurityAssessment({
    modelName: profile.defaultModel,
    protocol: profile.protocol,
    successRate,
    p95TotalMs,
    identityCheck,
    jsonPassed,
    toolCallPassed,
    streamPassed,
    errorCounts,
    tokenAudit,
    fingerprintSummary,
  });
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        successRate * 35 +
          passRate * 25 +
          (jsonPassed ? 10 : 0) +
          (toolCallPassed ? 10 : 0) +
          (streamPassed ? 10 : 0) +
          (identityPassed ? 5 : 0) +
          (codingPassed ? 10 : 0) +
          tokenCoverage * 5 -
          latencyPenalty -
          identityPenalty,
      ),
    ),
  );
  const grade = gradeAdmission(score, { successRate, severeError, toolCallPassed, jsonPassed, streamPassed, identityCheck });
  const recommendation = buildAdmissionRecommendation(grade, { severeError, successRate, p95TotalMs });

  return {
    runId,
    type: "admission",
    profileId: profile.id,
    profileName: profile.name,
    profileRole: profile.role || "target",
    provider: profile.provider,
    model: profile.defaultModel,
    protocol: profile.protocol,
    channelCode: profile.channelCode || "",
    packageLevel,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    requestCount,
    successCount,
    successRate,
    successRateText: `${Math.round(successRate * 100)}%`,
    passedCount,
    passRate,
    score,
    grade,
    avgTotalMs,
    p95TotalMs,
    inputTokens,
    outputTokens,
    ...economics,
    jsonPassed,
    toolCallPassed,
    streamPassed,
    identityPassed,
    identityCheck,
    purityAssessment,
    tokenAudit,
    fingerprintSummary,
    errorCounts,
    recommendation,
    nextAction: nextActionForAdmission(grade),
    cases: records.map((record) => ({
      id: record.caseId,
      name: record.caseName,
      passed: Boolean(record.admission?.passed),
      statusCode: record.statusCode,
      totalMs: record.totalMs,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      summary: record.responseSummary,
      issue: record.admission?.issue,
      identityCheck: record.admission?.identityCheck || null,
      streamValidation: record.streamValidation || null,
      probe: record.admission?.probe || false,
      signals: record.admission?.signals || [],
    })),
  };
}

function gradeAdmission(score, { successRate, severeError, toolCallPassed, jsonPassed, streamPassed, identityCheck }) {
  if (severeError === "auth_failed" || severeError === "model_not_found") return "F";
  if (severeError === "content_block_not_found") return "E";
  if (severeError === "upstream_5xx" && successRate < 0.8) return "X";
  if (identityCheck?.status === "conflict" && score < 80) return "D";
  if (score >= 90 && toolCallPassed && jsonPassed && streamPassed) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 55) return "D";
  if (successRate > 0) return "E";
  return "F";
}

function buildAdmissionRecommendation(grade, { severeError, successRate, p95TotalMs }) {
  if (grade === "A" || grade === "B") {
    return {
      level: "pass",
      title: "可进入稳定性和复杂场景测试",
      detail: "基础协议、结构和任务行为表现正常，可以继续做更高轮数稳定性、编程场景和成本测算。",
    };
  }
  if (grade === "C") {
    return {
      level: "watch",
      title: "可观察，需要复测",
      detail: "基础链路可用，但存在部分结构、工具调用、耗时或 token 返回问题。建议先复核配置，再做小轮数复测。",
    };
  }
  if (severeError) {
    return {
      level: "fail",
      title: "暂不建议接入",
      detail: `检测到关键错误 ${severeError}。建议先确认协议类型、模型名、Key 权限和上游渠道状态。`,
    };
  }
  if (p95TotalMs && p95TotalMs > 45000) {
    return {
      level: "watch",
      title: "链路较慢，需要观察",
      detail: "请求可以返回，但慢请求明显。建议换时段复测，并补充稳定性测试确认尾部延迟。",
    };
  }
  return {
    level: successRate > 0 ? "watch" : "fail",
    title: successRate > 0 ? "不建议直接开放" : "不可用",
    detail: successRate > 0 ? "有请求返回，但准入测试未达标。建议先内部排查和复测。" : "本轮没有有效响应，需要先修复配置或更换渠道。",
  };
}

function nextActionForAdmission(grade) {
  if (grade === "A" || grade === "B") return "进入稳定性测试和编程场景测试。";
  if (grade === "C") return "复核协议、模型名和工具调用后，再跑一次准入评测。";
  if (grade === "D" || grade === "E") return "先不要开放给用户，交给技术复核错误证据。";
  if (grade === "X") return "重点排查上游稳定性，换时段或换渠道复测。";
  return "暂停接入，先修复 Key、模型名、权限或上游状态。";
}

async function runStabilityForProfile({ profile, body, taskContext = {}, onProgress = null }) {
  const rounds = clampNumber(body.rounds, 1, 100, 10);
  const concurrency = clampNumber(body.concurrency, 1, 5, 1);
  const prompt = String(body.prompt || "").trim() || "请用两句话说明你可以正常工作，并返回当前测试编号。";
  const runId = `run-${compactDate(new Date())}-${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = new Date();
  const records = [];

  for (let index = 0; index < rounds; index += concurrency) {
    assertTaskNotCancelled(taskContext);
    const batch = Array.from({ length: Math.min(concurrency, rounds - index) }, (_, offset) => {
      const round = index + offset + 1;
      const casePrompt = buildRoundPrompt(prompt, round, rounds);
      return executeTestRequest(profile, casePrompt, {
        runId,
        caseId: `round-${round}`,
        writeLog: true,
      });
    });
    records.push(...(await Promise.all(batch)));
    onProgress?.(records.length, rounds);
  }

  const endedAt = new Date();
  let summary = buildStabilitySummary({
    runId,
    profile,
    records,
    rounds,
    concurrency,
    prompt,
    startedAt,
    endedAt,
  });
  summary = await attachRunArtifacts(runId, summary, { records });
  const aiAnalysis = await maybeBuildAiAnalysis({
    enabled: body.useAiReportAnalysis,
    reportType: "stability",
    profile,
    summary,
    runId,
    taskContext,
  });
  const reportMarkdown = formatStabilityReport(summary, records, { aiAnalysis });
  const reportFiles = await saveReportFiles(runId, reportMarkdown, "NexusAPI 稳定性测试报告");

  await appendJsonLine(TEST_RUNS_FILE, {
    ...summary,
    reportPath: reportFiles.markdownPath,
    reportHtmlPath: reportFiles.htmlPath,
    rawJsonPath: summary.rawJsonPath,
    workspaceDir: summary.workspaceDir,
    reportMarkdown: undefined,
  });

  return {
    ...summary,
    reportPath: reportFiles.markdownPath,
    reportHtmlPath: reportFiles.htmlPath,
    rawJsonPath: summary.rawJsonPath,
    workspaceDir: summary.workspaceDir,
    reportMarkdown,
  };
}

export async function runBatchStabilityTest(body, taskContext = {}) {
  const profiles = await loadProfiles();
  const profileIds = normalizeProfileIds(body.profileIds);
  if (profileIds.length === 0) {
    throw new Error("请至少选择一个被测 API。");
  }

  const existingIds = new Set(profiles.map((profile) => profile.id));
  const validProfileIds = profileIds.filter((profileId) => existingIds.has(profileId));
  if (validProfileIds.length === 0) {
    throw new Error("没有找到可用的被测 API 配置。");
  }

  const batchId = `batch-${compactDate(new Date())}-${crypto.randomUUID().slice(0, 8)}`;
  const maxParallelProfiles = clampNumber(body.maxParallelProfiles, 1, 5, 2);
  const startedAt = new Date();
  const results = [];

  for (let index = 0; index < validProfileIds.length; index += maxParallelProfiles) {
    assertTaskNotCancelled(taskContext);
    const batch = validProfileIds.slice(index, index + maxParallelProfiles);
    const settled = await Promise.allSettled(
      batch.map((profileId) => {
        const profile = profiles.find((item) => item.id === profileId);
        return runStabilityForProfile({
          profile,
          body: {
            ...body,
            profileId,
            useAiReportAnalysis: false,
          },
          taskContext,
        });
      }),
    );
    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(stripHeavyRunResult(result.value));
      } else {
        results.push({
          success: false,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
    updateTaskProgress(
      taskContext,
      results.length,
      validProfileIds.length,
      `批量稳定性测试进行中：${results.length}/${validProfileIds.length} 个 API`,
    );
  }

  const endedAt = new Date();
  let summary = {
    batchId,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    profileCount: validProfileIds.length,
    maxParallelProfiles,
    rounds: clampNumber(body.rounds, 1, 100, 10),
    requestConcurrency: clampNumber(body.concurrency, 1, 5, 1),
    results,
  };
  summary = await attachRunArtifacts(batchId, summary, { results });
  const aiAnalysisProfile = selectBatchAnalysisProfile(profiles, summary, validProfileIds);
  const aiAnalysis = await maybeBuildAiAnalysis({
    enabled: body.useAiReportAnalysis,
    reportType: "batch-stability",
    profile: aiAnalysisProfile,
    summary,
    runId: batchId,
    taskContext,
  });
  const reportMarkdown = formatBatchReport(summary, { aiAnalysis });
  const reportFiles = await saveReportFiles(batchId, reportMarkdown, "NexusAPI 批量稳定性测试总报告");

  await appendJsonLine(TEST_RUNS_FILE, {
    ...summary,
    type: "batch-stability",
    reportPath: reportFiles.markdownPath,
    reportHtmlPath: reportFiles.htmlPath,
    rawJsonPath: summary.rawJsonPath,
    workspaceDir: summary.workspaceDir,
    reportMarkdown: undefined,
  });

  return {
    ...summary,
    reportPath: reportFiles.markdownPath,
    reportHtmlPath: reportFiles.htmlPath,
    rawJsonPath: summary.rawJsonPath,
    workspaceDir: summary.workspaceDir,
    reportMarkdown,
  };
}

export async function runScenarioTest(body, taskContext = {}) {
  const profiles = await loadProfiles();
  const profileIds = normalizeProfileIds(body.profileIds);
  const scenarioIds = normalizeScenarioIds(body.scenarioIds);
  const selectedProfiles = profiles.filter((profile) => profileIds.includes(profile.id));
  const selectedScenarios = TEST_SCENARIOS.filter((scenario) => scenarioIds.includes(scenario.id));

  if (selectedProfiles.length === 0) {
    throw new Error("请至少选择一个被测 API。");
  }
  if (selectedScenarios.length === 0) {
    throw new Error("请至少选择一个测试场景。");
  }

  const runId = `scenario-${compactDate(new Date())}-${crypto.randomUUID().slice(0, 8)}`;
  const maxParallelProfiles = clampNumber(body.maxParallelProfiles, 1, 5, 2);
  const requestConcurrency = clampNumber(body.requestConcurrency || body.concurrency, 1, 3, 1);
  const repeats = clampNumber(body.repeats, 1, 5, 1);
  const startedAt = new Date();
  const profileResults = [];
  if (taskContext?.task) {
    taskContext.task.totalUnits = selectedProfiles.length * selectedScenarios.length * repeats;
  }

  for (let index = 0; index < selectedProfiles.length; index += maxParallelProfiles) {
    assertTaskNotCancelled(taskContext);
    const batch = selectedProfiles.slice(index, index + maxParallelProfiles);
    const results = await Promise.all(
      batch.map((profile) =>
        runScenarioProfile({
          runId,
          profile,
          scenarios: selectedScenarios,
          repeats,
          requestConcurrency,
          taskContext,
        }),
      ),
    );
    profileResults.push(...results);
    updateTaskProgress(
      taskContext,
      profileResults.length,
      selectedProfiles.length,
      `场景测试进行中：${profileResults.length}/${selectedProfiles.length} 个 API`,
    );
  }

  const endedAt = new Date();
  let summary = buildScenarioSummary({
    runId,
    profileResults,
    selectedScenarios,
    maxParallelProfiles,
    requestConcurrency,
    repeats,
    startedAt,
    endedAt,
  });
  summary = await attachRunArtifacts(runId, summary, { profileResults });
  const aiAnalysisProfile = selectScenarioAnalysisProfile(profiles, summary, profileIds);
  const aiAnalysis = await maybeBuildAiAnalysis({
    enabled: body.useAiReportAnalysis,
    reportType: "scenario",
    profile: aiAnalysisProfile,
    summary,
    runId,
    taskContext,
  });
  const reportMarkdown = formatScenarioReport(summary, { aiAnalysis });
  const reportFiles = await saveReportFiles(runId, reportMarkdown, "NexusAPI 场景测试报告");

  await appendJsonLine(TEST_RUNS_FILE, {
    ...summary,
    reportPath: reportFiles.markdownPath,
    reportHtmlPath: reportFiles.htmlPath,
    rawJsonPath: summary.rawJsonPath,
    workspaceDir: summary.workspaceDir,
    reportMarkdown: undefined,
  });

  return {
    ...summary,
    reportPath: reportFiles.markdownPath,
    reportHtmlPath: reportFiles.htmlPath,
    rawJsonPath: summary.rawJsonPath,
    workspaceDir: summary.workspaceDir,
    reportMarkdown,
  };
}

export function normalizeProfileIds(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeScenarioIds(value) {
  const ids = Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  return ids.length > 0 ? ids : TEST_SCENARIOS.map((scenario) => scenario.id);
}

async function runScenarioProfile({ runId, profile, scenarios, repeats, requestConcurrency, taskContext }) {
  const records = [];
  const jobs = [];
  for (const scenario of scenarios) {
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      jobs.push({ scenario, repeat });
    }
  }

  for (let index = 0; index < jobs.length; index += requestConcurrency) {
    assertTaskNotCancelled(taskContext);
    const batch = jobs.slice(index, index + requestConcurrency);
    const batchRecords = await Promise.all(
      batch.map(async ({ scenario, repeat }) => {
        const record = await executeTestRequest(profile, buildScenarioPrompt(scenario, repeat, repeats), {
          runId,
          caseId: scenario.id,
          writeLog: true,
        });
        const quality = evaluateScenarioOutput(scenario, record);
        delete record.responseText;
        return {
          ...record,
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          category: scenario.category,
          difficulty: scenario.difficulty,
          repeat,
          quality,
        };
      }),
    );
    records.push(...batchRecords);
    updateTaskProgress(
      taskContext,
      taskContext?.task?.completedUnits + batchRecords.length,
      taskContext?.task?.totalUnits || jobs.length,
      `场景测试 ${profile.name}：${records.length}/${jobs.length} 个场景请求`,
    );
  }

  return buildScenarioProfileSummary(profile, records);
}

async function executeTestRequest(profile, prompt, options = {}) {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const timeoutMs = Number(profile.timeoutMs || 60000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let firstByteMs = null;
  let totalMs = null;
  let statusCode = null;
  let responseText = "";
  let usage = null;
  let rawError = "";
  let normalizedError = "";

  try {
    // API keys are loaded only at request time and are never copied into logs or
    // reports. finalizeTestRecord writes only redacted request metadata.
    const apiKey = await readProfileApiKey(profile);
    if (!apiKey) {
      rawError = "API Key 未配置或无法从密钥存储读取。";
      normalizedError = "auth_failed";
      totalMs = 0;
      return await finalizeTestRecord({
        options,
        profile,
        requestId,
        startedAt,
        firstByteMs,
        totalMs,
        statusCode,
        responseText,
        usage,
        rawError,
        normalizedError,
      });
    }
    const request = buildProtocolRequest({ ...profile, apiKey }, prompt);
    const started = performance.now();
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    firstByteMs = Math.round(performance.now() - started);
    statusCode = response.status;
    const rawResult = await readBoundedResponseText(response, MAX_UPSTREAM_RESPONSE_BYTES, controller);
    totalMs = Math.round(performance.now() - started);
    if (rawResult.truncated) {
      rawError = `上游响应超过 ${MAX_UPSTREAM_RESPONSE_BYTES} bytes，已停止读取。`;
      normalizedError = "response_too_large";
      return await finalizeTestRecord({
        options,
        profile,
        requestId,
        startedAt,
        firstByteMs,
        totalMs,
        statusCode,
        responseText,
        usage,
        rawError,
        normalizedError,
      });
    }
    const raw = rawResult.text;

    if (!response.ok) {
      rawError = summarizeText(raw);
      normalizedError = normalizeHttpError(response.status, raw);
    } else {
      const parsed = safeJson(raw);
      responseText = extractOutputText(profile.protocol, parsed);
      usage = extractUsage(parsed);
      if (!responseText) {
        rawError = summarizeText(raw);
        normalizedError = normalizeEmptyResponse(raw);
      }
    }
  } catch (error) {
    totalMs = totalMs ?? timeoutMs;
    rawError = error instanceof Error ? error.message : String(error);
    normalizedError = /abort|timeout|timed out/i.test(rawError) ? "timeout" : "network_error";
  } finally {
    clearTimeout(timer);
  }

  return finalizeTestRecord({
    options,
    profile,
    requestId,
    startedAt,
    firstByteMs,
    totalMs,
    statusCode,
    responseText,
    usage,
    rawError,
    normalizedError,
  });
}

async function executeToolCallTestRequest(profile, options = {}) {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const timeoutMs = Number(profile.timeoutMs || 60000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let firstByteMs = null;
  let totalMs = null;
  let statusCode = null;
  let responseText = "";
  let usage = null;
  let rawError = "";
  let normalizedError = "";
  let toolCall = null;

  try {
    const apiKey = await readProfileApiKey(profile);
    if (!apiKey) {
      rawError = "API Key 未配置或无法从密钥存储读取。";
      normalizedError = "auth_failed";
      totalMs = 0;
      return await finalizeTestRecord({
        options,
        profile,
        requestId,
        startedAt,
        firstByteMs,
        totalMs,
        statusCode,
        responseText,
        usage,
        rawError,
        normalizedError,
        toolCall,
        successOverride: false,
      });
    }

    const request = buildProtocolToolRequest({ ...profile, apiKey });
    const started = performance.now();
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    firstByteMs = Math.round(performance.now() - started);
    statusCode = response.status;
    const rawResult = await readBoundedResponseText(response, MAX_UPSTREAM_RESPONSE_BYTES, controller);
    totalMs = Math.round(performance.now() - started);
    if (rawResult.truncated) {
      rawError = `上游响应超过 ${MAX_UPSTREAM_RESPONSE_BYTES} bytes，已停止读取。`;
      normalizedError = "response_too_large";
      return await finalizeTestRecord({
        options,
        profile,
        requestId,
        startedAt,
        firstByteMs,
        totalMs,
        statusCode,
        responseText,
        usage,
        rawError,
        normalizedError,
        toolCall,
        successOverride: false,
      });
    }

    const raw = rawResult.text;
    if (!response.ok) {
      rawError = summarizeText(raw);
      normalizedError = normalizeHttpError(response.status, raw);
    } else {
      const parsed = safeJson(raw);
      toolCall = extractToolCall(profile.protocol, parsed);
      usage = extractUsage(parsed);
      responseText = toolCall ? `tool_call:${toolCall.name}` : extractOutputText(profile.protocol, parsed);
      if (!toolCall) {
        rawError = summarizeText(raw);
        normalizedError = "tool_call_missing";
      }
    }
  } catch (error) {
    totalMs = totalMs ?? timeoutMs;
    rawError = error instanceof Error ? error.message : String(error);
    normalizedError = /abort|timeout|timed out/i.test(rawError) ? "timeout" : "network_error";
  } finally {
    clearTimeout(timer);
  }

  return finalizeTestRecord({
    options,
    profile,
    requestId,
    startedAt,
    firstByteMs,
    totalMs,
    statusCode,
    responseText,
    usage,
    rawError,
    normalizedError,
    toolCall,
    successOverride: Boolean(statusCode && statusCode >= 200 && statusCode < 300 && toolCall),
  });
}

async function executeStreamStructureTestRequest(profile, prompt, options = {}) {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const timeoutMs = Number(profile.timeoutMs || 60000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let firstByteMs = null;
  let totalMs = null;
  let statusCode = null;
  let responseText = "";
  let usage = null;
  let rawError = "";
  let normalizedError = "";
  let streamValidation = null;

  try {
    const apiKey = await readProfileApiKey(profile);
    if (!apiKey) {
      rawError = "API Key 未配置或无法从密钥存储读取。";
      normalizedError = "auth_failed";
      totalMs = 0;
      return await finalizeTestRecord({
        options,
        profile,
        requestId,
        startedAt,
        firstByteMs,
        totalMs,
        statusCode,
        responseText,
        usage,
        rawError,
        normalizedError,
        streamValidation,
        successOverride: false,
      });
    }

    const request = buildProtocolStreamRequest({ ...profile, apiKey }, prompt);
    const started = performance.now();
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    firstByteMs = Math.round(performance.now() - started);
    statusCode = response.status;
    const rawResult = await readBoundedResponseText(response, MAX_UPSTREAM_RESPONSE_BYTES, controller);
    totalMs = Math.round(performance.now() - started);
    if (rawResult.truncated) {
      rawError = `上游响应超过 ${MAX_UPSTREAM_RESPONSE_BYTES} bytes，已停止读取。`;
      normalizedError = "response_too_large";
      return await finalizeTestRecord({
        options,
        profile,
        requestId,
        startedAt,
        firstByteMs,
        totalMs,
        statusCode,
        responseText,
        usage,
        rawError,
        normalizedError,
        streamValidation,
        successOverride: false,
      });
    }

    const raw = rawResult.text;
    if (!response.ok) {
      rawError = summarizeText(raw);
      normalizedError = normalizeHttpError(response.status, raw);
    } else {
      streamValidation = summarizeStreamStructure(profile.protocol, raw);
      responseText = `stream_events:${streamValidation.eventCount}; issues:${streamValidation.issues.join(",") || "none"}`;
      if (!streamValidation.passed) {
        rawError = streamValidation.issues.join(", ") || summarizeText(raw);
        normalizedError = streamValidation.issues.includes("content_block_not_found")
          ? "content_block_not_found"
          : "stream_structure_invalid";
      }
    }
  } catch (error) {
    totalMs = totalMs ?? timeoutMs;
    rawError = error instanceof Error ? error.message : String(error);
    normalizedError = /abort|timeout|timed out/i.test(rawError) ? "timeout" : "network_error";
  } finally {
    clearTimeout(timer);
  }

  return finalizeTestRecord({
    options,
    profile,
    requestId,
    startedAt,
    firstByteMs,
    totalMs,
    statusCode,
    responseText,
    usage,
    rawError,
    normalizedError,
    streamValidation,
    successOverride: Boolean(statusCode && statusCode >= 200 && statusCode < 300 && streamValidation?.passed),
  });
}

export async function readBoundedResponseText(response, maxBytes, controller) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    controller.abort();
    return { text: "", truncated: true };
  }

  if (!response.body?.getReader) {
    if (!contentLength) {
      controller.abort();
      return { text: "", truncated: true };
    }
    const text = await response.text();
    return { text: text.slice(0, maxBytes), truncated: Buffer.byteLength(text, "utf8") > maxBytes };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        controller.abort();
        return { text: chunks.join(""), truncated: true };
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return { text: chunks.join(""), truncated: false };
  } finally {
    reader.releaseLock?.();
  }
}

export function stripHeavyRunResult(result) {
  if (!result || typeof result !== "object") {
    return result;
  }
  const { reportMarkdown, records, ...safeResult } = result;
  return {
    ...safeResult,
    recordCount: Array.isArray(records) ? records.length : undefined,
  };
}

async function finalizeTestRecord({
  options,
  profile,
  requestId,
  startedAt,
  firstByteMs,
  totalMs,
  statusCode,
  responseText,
  usage,
  rawError,
  normalizedError,
  toolCall = null,
  streamValidation = null,
  successOverride = undefined,
}) {
  const record = {
    requestId,
    runId: options.runId || "manual-test",
    caseId: options.caseId || "",
    profileId: profile.id,
    profileName: profile.name,
    profileRole: profile.role || "target",
    provider: profile.provider,
    model: profile.defaultModel,
    protocol: profile.protocol,
    startedAt: startedAt.toISOString(),
    firstByteMs,
    firstTokenMs: firstByteMs,
    totalMs,
    statusCode,
    success: successOverride ?? Boolean(statusCode && statusCode >= 200 && statusCode < 300 && responseText),
    normalizedError,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    cacheCreationTokens: usage?.cacheCreationTokens ?? null,
    cacheReadTokens: usage?.cacheReadTokens ?? null,
    reasoningTokens: usage?.reasoningTokens ?? null,
    tokenSource: usage ? "upstream" : "unknown",
    outputChars: responseText.length,
    responseSummary: summarizeText(responseText),
    responseText,
    toolCall,
    streamValidation,
    rawError: summarizeText(rawError),
  };

  if (options.writeLog !== false) {
    const logRecord = { ...record };
    // Full response text can be large and user-provided; keep reports useful but
    // avoid turning request logs into a data dump.
    delete logRecord.responseText;
    await appendJsonLine(REQUEST_LOG_FILE, logRecord);
    // 双写 SQLite（过渡期）：逐请求全量历史，供统计严谨用。best-effort，
    // node:sqlite 不可用或出错时静默跳过，JSONL 仍是事实来源。
    await recordRequest(logRecord);
  }
  return record;
}

function buildRoundPrompt(prompt, round, rounds) {
  return [
    prompt,
    "",
    `本次是稳定性测试第 ${round}/${rounds} 轮。`,
    "请正常完成任务，不要只回复测试编号。",
  ].join("\n");
}

function buildScenarioPrompt(scenario, repeat, repeats) {
  if (repeats <= 1) {
    return scenario.prompt;
  }
  return [
    scenario.prompt,
    "",
    `本次是场景测试 ${scenario.name} 的第 ${repeat}/${repeats} 次重复测试。`,
    "请正常完成任务，不要只回复测试编号。",
  ].join("\n");
}

async function maybeBuildAiAnalysis({ enabled, reportType, profile, summary, runId, taskContext }) {
  if (!isAiReportAnalysisEnabled(enabled)) {
    return { enabled: false };
  }
  assertTaskNotCancelled(taskContext);
  if (!profile) {
    return {
      enabled: true,
      success: false,
      error: "没有找到可用于生成 AI 分析的 API 配置。",
    };
  }

  const prompt = buildAiReportAnalysisPrompt({ reportType, summary });
  const record = await executeTestRequest(
    {
      ...profile,
      maxTokens: Math.max(Number(profile.maxTokens || 0), 1200),
      timeoutMs: Math.max(Number(profile.timeoutMs || 0), 90000),
    },
    prompt,
    {
      runId,
      caseId: "ai-report-analysis",
      writeLog: true,
    },
  );
  return buildAiAnalysisResult(record);
}

function selectBatchAnalysisProfile(profiles, summary, fallbackProfileIds) {
  const ranked = [...(summary.results || [])]
    .filter((result) => !result.error)
    .sort((a, b) => b.successRate - a.successRate || (a.p95TotalMs ?? Infinity) - (b.p95TotalMs ?? Infinity));
  const profileId = ranked[0]?.profileId || fallbackProfileIds[0];
  return profiles.find((profile) => profile.id === profileId) || null;
}

function selectScenarioAnalysisProfile(profiles, summary, fallbackProfileIds) {
  const ranked = [...(summary.results || [])]
    .filter((result) => !result.error)
    .sort(
      (a, b) =>
        b.avgQualityScore - a.avgQualityScore ||
        b.successRate - a.successRate ||
        (a.p95TotalMs ?? Infinity) - (b.p95TotalMs ?? Infinity),
    );
  const profileId = ranked[0]?.profileId || fallbackProfileIds[0];
  return profiles.find((profile) => profile.id === profileId) || null;
}
