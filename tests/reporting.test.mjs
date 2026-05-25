import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("stability reports contain useful conclusions and no API key", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "nexusapi-report-test-"));
  process.env.NEXUSAPI_DATA_DIR = dataDir;

  try {
    const reporting = await import(`../server/reporting.mjs?case=${Date.now()}`);
    const summary = {
      runId: "run-test",
      profileName: "Test API",
      provider: "Provider",
      model: "model-a",
      protocol: "openai_compatible",
      channelCode: "CH-A",
      rounds: 2,
      concurrency: 1,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:02.000Z",
      durationMs: 2000,
      successRate: 0.5,
      successRateText: "50%",
      successCount: 1,
      avgFirstByteMs: 100,
      avgTotalMs: 200,
      p50TotalMs: 200,
      p95TotalMs: 200,
      minTotalMs: 200,
      maxTotalMs: 200,
      avgOutputChars: 20,
      inputTokens: 10,
      outputTokens: 5,
      errorCounts: { auth_failed: 1 },
      diagnostics: reporting.buildErrorDiagnostics({ auth_failed: 1 }),
      recommendation: reporting.buildRecommendation(0.5, 200, { auth_failed: 1 }),
      promptPreview: "hello with sk-should-not-be-in-report",
    };
    const markdown = reporting.formatStabilityReport(summary, [
      {
        success: true,
        statusCode: 200,
        firstByteMs: 100,
        totalMs: 200,
        outputChars: 20,
        responseSummary: "ok",
      },
      {
        success: false,
        normalizedError: "auth_failed",
        statusCode: 401,
        firstByteMs: 50,
        totalMs: 50,
        outputChars: 0,
        rawError: "Unauthorized",
      },
    ]);

    assert.match(markdown, /NexusAPI 稳定性测试报告/);
    assert.match(markdown, /给业务人员看的结论/);
    assert.match(markdown, /关键数据解读/);
    assert.match(markdown, /阅读顺序/);
    assert.match(markdown, /专业汇总结论/);
    assert.match(markdown, /单轮明细/);
    assert.match(markdown, /认证失败/);
    assert.match(markdown, /报告不包含 API Key/);
    assert.equal(markdown.includes("sk-real-secret"), false);

    const files = await reporting.saveReportFiles("run-test", markdown, "测试报告");
    const html = await readFile(files.htmlPath, "utf8");
    assert.match(html, /<!doctype html>/);
    assert.match(html, /NexusAPI Evaluator 本地生成/);
  } finally {
    delete process.env.NEXUSAPI_DATA_DIR;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("reports can include optional AI analysis without replacing local conclusions", async () => {
  const reporting = await import(`../server/reporting.mjs?case=ai-analysis-${Date.now()}`);
  const summary = {
    runId: "run-ai",
    profileName: "AI API",
    provider: "Provider",
    model: "model-a",
    protocol: "openai_compatible",
    channelCode: "CH-A",
    rounds: 1,
    concurrency: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:02.000Z",
    durationMs: 2000,
    successRate: 1,
    successRateText: "100%",
    successCount: 1,
    failureCount: 0,
    avgFirstByteMs: 100,
    avgTotalMs: 200,
    p50TotalMs: 200,
    p95TotalMs: 200,
    minTotalMs: 200,
    maxTotalMs: 200,
    avgOutputChars: 20,
    inputTokens: 10,
    outputTokens: 5,
    errorCounts: {},
    diagnostics: [],
    recommendation: reporting.buildRecommendation(1, 200, {}),
    promptPreview: "hello",
  };
  const markdown = reporting.formatStabilityReport(summary, [], {
    aiAnalysis: {
      enabled: true,
      success: true,
      text: "## AI 人话结论\n建议继续测试。",
      inputTokens: 100,
      outputTokens: 50,
    },
  });

  assert.match(markdown, /给业务人员看的结论/);
  assert.match(markdown, /AI 辅助分析（可选）/);
  assert.match(markdown, /额外消耗：输入 100 tokens，输出 50 tokens/);
  assert.match(markdown, /最终判断仍要结合本地规则结论/);
  assert.match(markdown, /AI 人话结论/);
});

test("scenario reports explain content safety risks in plain language", async () => {
  const reporting = await import(`../server/reporting.mjs?case=safety-${Date.now()}`);
  const markdown = reporting.formatScenarioReport({
    runId: "scenario-test",
    profileCount: 1,
    scenarioCount: 2,
    repeats: 1,
    maxParallelProfiles: 1,
    requestConcurrency: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:02.000Z",
    durationMs: 2000,
    results: [
      {
        profileName: "Demo API",
        model: "demo-model",
        successRate: 1,
        successRateText: "100%",
        avgQualityScore: 72,
        avgTotalMs: 1000,
        p95TotalMs: 1200,
        errorCounts: {},
        diagnostics: [],
        recommendation: reporting.buildScenarioRecommendation(1, 72, 1200, {}),
        scenarios: [
          {
            scenarioName: "内容安全：色情低风险探测",
            category: "safety",
            successRateText: "100%",
            avgQualityScore: 72,
            avgTotalMs: 1000,
            p95TotalMs: 1200,
            issues: ["疑似直接满足风险请求"],
          },
          {
            scenarioName: "内容安全：暴力伤害低风险探测",
            category: "safety",
            successRateText: "100%",
            avgQualityScore: 100,
            avgTotalMs: 900,
            p95TotalMs: 900,
            issues: [],
          },
        ],
      },
    ],
  });

  assert.match(markdown, /内容安全合规结论/);
  assert.match(markdown, /关键数据解读/);
  assert.match(markdown, /场景结论/);
  assert.match(markdown, /处理建议/);
  assert.match(markdown, /高风险，必须复核/);
  assert.match(markdown, /暂不建议用于开放内容场景/);
  assert.match(markdown, /需要人工复核的场景/);
  assert.match(markdown, /成功率` 只代表 API 有返回/);
  assert.match(markdown, /重点看原始回答/);
});

test("batch reports include readable comparison data and next steps", async () => {
  const reporting = await import(`../server/reporting.mjs?case=batch-${Date.now()}`);
  const markdown = reporting.formatBatchReport({
    batchId: "batch-test",
    profileCount: 2,
    rounds: 3,
    maxParallelProfiles: 2,
    requestConcurrency: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:10.000Z",
    durationMs: 10000,
    results: [
      {
        profileName: "Fast API",
        successRate: 1,
        successRateText: "100%",
        avgTotalMs: 1000,
        p95TotalMs: 1200,
        recommendation: reporting.buildRecommendation(1, 1200, {}),
        diagnostics: [],
        reportPath: "fast.md",
      },
      {
        profileName: "Slow API",
        successRate: 0.67,
        successRateText: "67%",
        avgTotalMs: 50000,
        p95TotalMs: 60000,
        recommendation: reporting.buildRecommendation(0.67, 60000, { timeout: 1 }),
        diagnostics: reporting.buildErrorDiagnostics({ timeout: 1 }),
        reportPath: "slow.md",
      },
    ],
  });

  assert.match(markdown, /批量稳定性测试总报告/);
  assert.match(markdown, /关键数据解读/);
  assert.match(markdown, /当前最优/);
  assert.match(markdown, /失败或低成功率配置/);
  assert.match(markdown, /使用建议/);
  assert.match(markdown, /低延迟场景/);
});
