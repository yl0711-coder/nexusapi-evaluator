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
  buildProtocolRequest,
  extractOutputText,
  extractUsage,
  normalizeEmptyResponse,
  normalizeHttpError,
} from "./protocols.mjs";
import {
  formatBatchReport,
  formatScenarioReport,
  formatStabilityReport,
  saveReportFiles,
} from "./reporting.mjs";
import { buildScenarioProfileSummary, buildScenarioSummary, buildStabilitySummary } from "./summaries.mjs";
import { assertTaskNotCancelled, updateTaskProgress } from "./task-manager.mjs";
import {
  appendJsonLine,
  clampNumber,
  compactDate,
  safeJson,
  summarizeText,
} from "./utils.mjs";

const MAX_UPSTREAM_RESPONSE_BYTES = 2 * 1024 * 1024;

// Owns all real upstream evaluation work. server.mjs should route requests here
// instead of carrying test execution details in the HTTP entrypoint.
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
  const summary = buildStabilitySummary({
    runId,
    profile,
    records,
    rounds,
    concurrency,
    prompt,
    startedAt,
    endedAt,
  });
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
    reportMarkdown: undefined,
  });

  return {
    ...summary,
    reportPath: reportFiles.markdownPath,
    reportHtmlPath: reportFiles.htmlPath,
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
  const summary = {
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

  return {
    ...summary,
    reportPath: reportFiles.markdownPath,
    reportHtmlPath: reportFiles.htmlPath,
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
  const summary = buildScenarioSummary({
    runId,
    profileResults,
    selectedScenarios,
    maxParallelProfiles,
    requestConcurrency,
    repeats,
    startedAt,
    endedAt,
  });
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
    reportMarkdown: undefined,
  });

  return {
    ...summary,
    reportPath: reportFiles.markdownPath,
    reportHtmlPath: reportFiles.htmlPath,
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
}) {
  const record = {
    requestId,
    runId: options.runId || "manual-test",
    caseId: options.caseId || "",
    profileId: profile.id,
    profileName: profile.name,
    provider: profile.provider,
    model: profile.defaultModel,
    protocol: profile.protocol,
    startedAt: startedAt.toISOString(),
    firstByteMs,
    firstTokenMs: firstByteMs,
    totalMs,
    statusCode,
    success: Boolean(statusCode && statusCode >= 200 && statusCode < 300 && responseText),
    normalizedError,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    tokenSource: usage ? "upstream" : "unknown",
    outputChars: responseText.length,
    responseSummary: summarizeText(responseText),
    responseText,
    rawError: summarizeText(rawError),
  };

  if (options.writeLog !== false) {
    const logRecord = { ...record };
    // Full response text can be large and user-provided; keep reports useful but
    // avoid turning request logs into a data dump.
    delete logRecord.responseText;
    await appendJsonLine(REQUEST_LOG_FILE, logRecord);
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
