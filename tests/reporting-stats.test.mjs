import assert from "node:assert/strict";
import test from "node:test";

import { buildStabilitySummary } from "../server/summaries.mjs";
import { formatBatchReport, formatStabilityReport } from "../server/reporting.mjs";

const profile = (id, name) => ({
  id,
  name,
  role: "target",
  provider: "mock",
  defaultModel: "mock-model",
  protocol: "openai_compatible",
  channelCode: "",
});

function makeRecords(successCount, total) {
  const records = [];
  for (let i = 0; i < total; i++) {
    const success = i < successCount;
    records.push({
      success,
      totalMs: success ? 1000 + i * 100 : null,
      firstByteMs: success ? 200 + i * 10 : null,
      outputChars: success ? 120 : 0,
      inputTokens: success ? 50 : null,
      outputTokens: success ? 30 : null,
      normalizedError: success ? null : "upstream_5xx",
    });
  }
  return records;
}

function makeStabilitySummary(id, name, successCount, total) {
  const records = makeRecords(successCount, total);
  return buildStabilitySummary({
    runId: `run-${id}`,
    profile: profile(id, name),
    records,
    rounds: total,
    concurrency: 1,
    prompt: "ping",
    startedAt: new Date("2026-06-02T00:00:00Z"),
    endedAt: new Date("2026-06-02T00:01:00Z"),
  });
}

test("buildStabilitySummary attaches Wilson CI and P99", () => {
  const summary = makeStabilitySummary("a", "甲", 8, 10);
  assert.equal(summary.successRateCi.n, 10);
  assert.equal(summary.successRateCi.ratePercent, "80.0%");
  assert.ok(summary.successRateCi.ci95Lower > 0.45 && summary.successRateCi.ci95Lower < 0.55);
  assert.ok(summary.successRateCi.ci95Upper > 0.9 && summary.successRateCi.ci95Upper < 0.97);
  assert.ok(Number.isFinite(summary.p99TotalMs));
  assert.ok(summary.p99TotalMs >= summary.p95TotalMs);
});

test("stability report renders CI and P99 lines", () => {
  const summary = makeStabilitySummary("a", "甲", 8, 10);
  const report = formatStabilityReport(summary, makeRecords(8, 10));
  assert.match(report, /成功率 95% 置信区间/);
  assert.match(report, /尾部延迟 P99/);
  assert.ok(report.includes(summary.successRateCi.ci95Text));
});

function makeBatch(results) {
  return {
    batchId: "batch-1",
    profileCount: results.length,
    rounds: 10,
    maxParallelProfiles: 1,
    requestConcurrency: 1,
    startedAt: "2026-06-02T00:00:00Z",
    endedAt: "2026-06-02T00:05:00Z",
    durationMs: 300000,
    workspaceDir: "/tmp/x",
    rawJsonPath: "/tmp/x.json",
    results,
  };
}

test("batch report does NOT declare a winner when CIs overlap", () => {
  const batch = makeBatch([
    makeStabilitySummary("a", "甲", 8, 10),
    makeStabilitySummary("b", "乙", 6, 10),
  ]);
  const report = formatBatchReport(batch);
  assert.match(report, /差异不显著/);
  assert.match(report, /建议增加轮数/);
});

test("batch report declares a statistically distinguishable winner when CIs separate", () => {
  const batch = makeBatch([
    makeStabilitySummary("a", "甲", 10, 10),
    makeStabilitySummary("b", "乙", 2, 10),
  ]);
  const report = formatBatchReport(batch);
  assert.match(report, /统计上可区分/);
  assert.match(report, /甲 优于 乙/);
});
