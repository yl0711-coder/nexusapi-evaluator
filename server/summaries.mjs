import { maskScenario } from "./profile-store.mjs";
import { aggregateUsage, estimateProfileRunEconomics } from "./costing.mjs";
import {
  buildErrorDiagnostics,
  buildRecommendation,
  buildScenarioRecommendation,
  countErrors,
} from "./reporting.mjs";
import { formatPercent, groupBy, isFiniteNumber, mean, percentile, summarizeText } from "./utils.mjs";

export function buildStabilitySummary({ runId, profile, records, rounds, concurrency, prompt, startedAt, endedAt }) {
  const successRecords = records.filter((item) => item.success);
  const failedRecords = records.filter((item) => !item.success);
  const totalTimes = successRecords.map((item) => item.totalMs).filter(isFiniteNumber);
  const firstByteTimes = successRecords.map((item) => item.firstByteMs).filter(isFiniteNumber);
  const outputChars = successRecords.map((item) => item.outputChars).filter(isFiniteNumber);
  const errorCounts = countErrors(failedRecords);
  const successRate = records.length > 0 ? successRecords.length / records.length : 0;
  const p95TotalMs = percentile(totalTimes, 0.95);
  const recommendation = buildRecommendation(successRate, p95TotalMs, errorCounts);
  const usageTotals = aggregateUsage(records);
  const { inputTokens, outputTokens } = usageTotals;
  const economics = estimateProfileRunEconomics(profile, { inputTokens, outputTokens });

  return {
    runId,
    profileId: profile.id,
    profileName: profile.name,
    profileRole: profile.role || "target",
    provider: profile.provider,
    model: profile.defaultModel,
    protocol: profile.protocol,
    channelCode: profile.channelCode || "",
    rounds,
    concurrency,
    promptPreview: summarizeText(prompt),
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    successCount: successRecords.length,
    failureCount: failedRecords.length,
    successRate,
    successRateText: formatPercent(successRate),
    avgFirstByteMs: Math.round(mean(firstByteTimes) || 0),
    avgTotalMs: Math.round(mean(totalTimes) || 0),
    p50TotalMs: percentile(totalTimes, 0.5),
    p95TotalMs,
    minTotalMs: totalTimes.length ? Math.min(...totalTimes) : null,
    maxTotalMs: totalTimes.length ? Math.max(...totalTimes) : null,
    avgOutputChars: Math.round(mean(outputChars) || 0),
    inputTokens,
    outputTokens,
    cacheCreationTokens: usageTotals.cacheCreationTokens,
    cacheReadTokens: usageTotals.cacheReadTokens,
    reasoningTokens: usageTotals.reasoningTokens,
    ...economics,
    errorCounts,
    diagnostics: buildErrorDiagnostics(errorCounts),
    recommendation,
  };
}

export function buildScenarioProfileSummary(profile, records) {
  const successRecords = records.filter((record) => record.success);
  const failedRecords = records.filter((record) => !record.success);
  const totalTimes = successRecords.map((record) => record.totalMs).filter(isFiniteNumber);
  const qualityScores = records.map((record) => record.quality?.score).filter(isFiniteNumber);
  const successRate = records.length > 0 ? successRecords.length / records.length : 0;
  const avgQualityScore = Math.round(mean(qualityScores) || 0);
  const errorCounts = countErrors(failedRecords);
  const usageTotals = aggregateUsage(records);
  const { inputTokens, outputTokens } = usageTotals;
  const economics = estimateProfileRunEconomics(profile, { inputTokens, outputTokens });
  const scenarioGroups = groupBy(records, (record) => record.scenarioId);
  const scenarios = Object.entries(scenarioGroups).map(([scenarioId, items]) => {
    const okItems = items.filter((item) => item.success);
    const scores = items.map((item) => item.quality?.score).filter(isFiniteNumber);
    const times = okItems.map((item) => item.totalMs).filter(isFiniteNumber);
    return {
      scenarioId,
      scenarioName: items[0]?.scenarioName || scenarioId,
      category: items[0]?.category || "",
      difficulty: items[0]?.difficulty || "",
      count: items.length,
      successCount: okItems.length,
      successRate: items.length ? okItems.length / items.length : 0,
      successRateText: formatPercent(items.length ? okItems.length / items.length : 0),
      avgTotalMs: Math.round(mean(times) || 0),
      p95TotalMs: percentile(times, 0.95),
      avgQualityScore: Math.round(mean(scores) || 0),
      issues: [...new Set(items.flatMap((item) => item.quality?.issues || []))],
    };
  });

  return {
    profileId: profile.id,
    profileName: profile.name,
    profileRole: profile.role || "target",
    provider: profile.provider,
    model: profile.defaultModel,
    protocol: profile.protocol,
    channelCode: profile.channelCode || "",
    caseCount: records.length,
    successCount: successRecords.length,
    successRate,
    successRateText: formatPercent(successRate),
    avgTotalMs: Math.round(mean(totalTimes) || 0),
    p95TotalMs: percentile(totalTimes, 0.95),
    avgQualityScore,
    inputTokens,
    outputTokens,
    cacheCreationTokens: usageTotals.cacheCreationTokens,
    cacheReadTokens: usageTotals.cacheReadTokens,
    reasoningTokens: usageTotals.reasoningTokens,
    ...economics,
    errorCounts,
    diagnostics: buildErrorDiagnostics(errorCounts),
    recommendation: buildScenarioRecommendation(successRate, avgQualityScore, percentile(totalTimes, 0.95), errorCounts),
    scenarios,
    records,
  };
}

export function buildScenarioSummary({
  runId,
  profileResults,
  selectedScenarios,
  maxParallelProfiles,
  requestConcurrency,
  repeats,
  startedAt,
  endedAt,
}) {
  return {
    runId,
    type: "scenario",
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    profileCount: profileResults.length,
    scenarioCount: selectedScenarios.length,
    repeats,
    maxParallelProfiles,
    requestConcurrency,
    scenarios: selectedScenarios.map(maskScenario),
    results: profileResults,
  };
}
