export function recommendationClass(level) {
  return {
    pass: "ok",
    watch: "warn",
    fail: "fail",
  }[level] || "muted";
}

export function formatTaskType(type) {
  return {
    stability: "稳定性测试",
    "batch-stability": "批量稳定性测试",
    scenario: "场景测试",
  }[type] || type || "-";
}

export function formatTaskStatus(status) {
  return {
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "已中断",
  }[status] || status || "-";
}

export function taskStatusClass(status) {
  return {
    running: "warn",
    completed: "ok",
    failed: "fail",
    cancelled: "warn",
    interrupted: "fail",
  }[status] || "muted";
}

export function formatResult(result) {
  const statusText = result.success ? "这条配置可以正常请求。" : "这条配置暂时不能正常使用。";
  const issueText = result.success ? "没有发现明显问题。" : `问题类型：${result.normalizedError || "未知错误"}。`;
  const lines = [
    `结论：${result.success ? "可继续测试" : "先不要继续测试"}`,
    `说明：${statusText}`,
    `问题：${issueText}`,
    `耗时：${result.totalMs ?? "-"} ms`,
    `输出长度：${result.outputChars ?? 0} 字符`,
    "",
    "响应摘要：",
    result.responseSummary || result.rawError || "-",
  ];
  return lines.join("\n");
}

export function formatBatchResult(result) {
  const lines = [
    `批次：${result.batchId}`,
    `被测 API：${result.profileCount}`,
    `同时测试 API 数：${result.maxParallelProfiles}`,
    `每个 API 轮数：${result.rounds}`,
    `总耗时：${result.durationMs} ms`,
    `报告文件：${result.reportPath || "-"}`,
  ];
  return lines.join("\n");
}

export function formatStabilityResult(result) {
  const lines = [
    `测试 ID：${result.runId || "-"}`,
    `被测 API：${result.profileName || "-"}`,
    `模型：${result.model || "-"}`,
    `测试轮数：${result.rounds ?? "-"}`,
    `成功率：${result.successRateText || "-"}`,
    `平均耗时：${result.avgTotalMs || "-"} ms`,
    `慢请求参考：${result.p95TotalMs ?? "-"} ms`,
    `结论：${result.recommendation?.title || "-"}`,
    `说明：${result.recommendation?.detail || "-"}`,
    `Markdown 报告：${result.reportPath || "-"}`,
    `HTML 报告：${result.reportHtmlPath || "-"}`,
  ];
  return lines.join("\n");
}

export function formatScenarioResult(result) {
  const lines = [
    `测试 ID：${result.runId}`,
    `被测 API：${result.profileCount}`,
    `测试场景：${result.scenarioCount}`,
    `每个场景重复次数：${result.repeats}`,
    `总耗时：${result.durationMs} ms`,
    `报告文件：${result.reportPath || "-"}`,
  ];
  return lines.join("\n");
}
