import { escapeHtml } from "./client-utils.js";

// Pure workflow helpers for the dashboard. They decide what the operator should
// do next, while app.js only renders the returned step and wires navigation.
export function buildWorkflowStatus(state) {
  const targets = state.profiles.filter((profile) => profile.role === "target");
  const successfulRequests = state.requests.filter((request) => request.success);
  const stabilityRuns = state.testRuns.filter((run) => run.type !== "scenario");
  const scenarioRuns = state.testRuns.filter((run) => run.type === "scenario");

  return {
    profiles: targets.length > 0,
    quick: successfulRequests.length > 0,
    stability: stabilityRuns.length > 0,
    scenario: scenarioRuns.length > 0,
    reports: state.testRuns.length > 0,
    handoff: state.testRuns.length > 0,
  };
}

export function getNextWorkflowStep(status) {
  if (!status.profiles) {
    return {
      step: "profiles",
      page: "profiles",
      title: "先新增一个被测 API 配置",
      detail: "没有 API 配置时，其他测试都无法产生有效结果。先填写平台地址、Key、模型名和协议。",
      button: "去配置 API",
    };
  }
  if (!status.quick) {
    return {
      step: "quick",
      page: "quick-test",
      title: "先做 1 次快速连通测试",
      detail: "快速测试成本最低，可以先排除 URL、Key、模型名、协议错误。",
      button: "去快速测试",
    };
  }
  if (!status.stability) {
    return {
      step: "stability",
      page: "stability-test",
      title: "跑 3 轮或 10 轮稳定性测试",
      detail: "快速测试成功只代表单次能通，稳定性测试才能看到成功率、慢请求和错误分布。",
      button: "去稳定性测试",
    };
  }
  if (!status.scenario) {
    return {
      step: "scenario",
      page: "scenario-test",
      title: "选择少量场景做复杂任务评估",
      detail: "建议先选 2-3 个场景，不要一开始全量跑，避免浪费额度。",
      button: "去场景测试",
    };
  }
  return {
    step: "handoff",
    page: "handoff",
    title: "复制测试交付模板",
    detail: "把测试对象、关键指标、异常、报告文件和下一步建议一次性发给负责人。",
    button: "生成交付内容",
  };
}

export function renderNextActionHtml(next) {
  return `
    <strong>当前建议：${escapeHtml(next.title)}</strong>
    <span>${escapeHtml(next.detail)}</span>
    <button class="primary" type="button" data-go-page="${next.page}">${escapeHtml(next.button)}</button>
  `;
}
