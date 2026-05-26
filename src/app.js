import {
  downloadText,
  escapeHtml,
  renderMarkdown,
  toast,
} from "./client-utils.js";
import { installClientErrorReporter } from "./client-error-reporter.js";
import { copyText } from "./clipboard.js";
import { api, cancelRemoteTask } from "./api-client.js";
import { createConfirmDialog } from "./confirm-dialog.js";
import {
  confirmExecution,
  estimateStandardCost,
  estimateBatchCost,
  estimateScenarioCost,
  estimateStabilityCost,
} from "./cost-estimates.js";
import { renderDeliveryPanels } from "./delivery-panel.js";
import {
  formatBatchResult,
  formatScenarioResult,
} from "./formatters.js";
import { renderRequestList, renderTaskEventList, renderTestRunList } from "./history-view.js";
import { buildWorkflowStatus, getNextWorkflowStep, renderNextActionHtml } from "./workflow-guide.js";
import { buildDemoData } from "./demo-data.js";
import { requireElement, requireElements } from "./dom-utils.js";
import { createKeyModal } from "./key-modal.js";
import { renderPageHelp as renderPageHelpPanel } from "./page-help.js";
import { renderProfileConfigCheck as renderProfileConfigCheckPanel } from "./profile-config-check.js";
import { renderMissingKeyPanel, renderProfileList, renderProfileSelectOptions } from "./profile-view.js";
import {
  applyPromptPresetToForm,
  renderPromptPresetOptions,
} from "./prompt-presets.js";
import { createProfileController } from "./profile-controller.js";
import { createQuickTestController } from "./quick-test-controller.js";
import { createQuickFailurePanel } from "./quick-failure-panel.js";
import { createStandardEvalController } from "./standard-eval-controller.js";
import { renderStabilitySummary as renderStabilitySummaryPanel } from "./stability-view.js";
import { updateEstimateLabels } from "./test-estimates.js";
import { createTaskFormController, requireSelectedValues } from "./test-form-controller.js";
import {
  applyBatchTemplate as applyBatchTemplateToForm,
  applyProfileTemplate as applyProfileTemplateToForm,
  applyScenarioTemplate as applyScenarioTemplateToForm,
  applyStabilityTemplate as applyStabilityTemplateToForm,
} from "./test-templates.js";
import {
  hydrateProjectInfoForm as hydrateProjectInfoFormFields,
  loadProjectInfo,
  saveProjectInfo,
} from "./project-info.js";

installClientErrorReporter();

const state = {
  profiles: [],
  requests: [],
  testRuns: [],
  taskEvents: [],
  scenarios: [],
  manualLoaded: false,
  latestReport: "",
  activeTasks: {},
  projectInfo: loadProjectInfo(),
  latestStandardProfileId: "",
  demoMode: false,
  health: null,
};

const pages = requireElements(".page");
const navButtons = requireElements(".nav-button");
const projectInfoForm = requireElement("#project-info-form");
const projectInfoSummary = requireElement("#project-info-summary");
const profileForm = requireElement("#profile-form");
const profileList = requireElement("#profile-list");
const profileTemplate = requireElement("#profile-template");
const profileCheckResult = requireElement("#profile-check-result");
const quickTestForm = requireElement("#quick-test-form");
const quickProfileSelect = requireElement("#quick-profile-select");
const quickTestResult = requireElement("#quick-test-result");
const quickPromptPreset = requireElement("#quick-prompt-preset");
const quickPromptHint = requireElement("#quick-prompt-hint");
const requestList = requireElement("#request-list");
const standardEvalForm = requireElement("#standard-eval-form");
const standardProfileSelect = requireElement("#standard-profile-select");
const standardPromptPreset = requireElement("#standard-prompt-preset");
const standardPromptHint = requireElement("#standard-prompt-hint");
const standardEvalSubmit = requireElement("#standard-eval-submit");
const standardPlainResult = requireElement("#standard-plain-result");
const standardEvalResult = requireElement("#standard-eval-result");
const standardNextActions = requireElement("#standard-next-actions");
const standardEvalProgress = requireElement("#standard-eval-progress");
const standardTaskProgress = requireElement("#standard-task-progress");
const stabilityTestForm = requireElement("#stability-test-form");
const stabilityProfileSelect = requireElement("#stability-profile-select");
const stabilitySubmit = requireElement("#stability-submit");
const stabilitySummary = requireElement("#stability-summary");
const stabilityReport = requireElement("#stability-report");
const batchTestForm = requireElement("#batch-test-form");
const batchProfileSelect = requireElement("#batch-profile-select");
const batchSubmit = requireElement("#batch-submit");
const batchTestResult = requireElement("#batch-test-result");
const scenarioTestForm = requireElement("#scenario-test-form");
const scenarioProfileSelect = requireElement("#scenario-profile-select");
const scenarioCaseSelect = requireElement("#scenario-case-select");
const scenarioSubmit = requireElement("#scenario-submit");
const scenarioTestResult = requireElement("#scenario-test-result");
const testRunList = requireElement("#test-run-list");
const taskEventList = requireElement("#task-event-list");
const stabilityTemplate = requireElement("#stability-template");
const batchTemplate = requireElement("#batch-template");
const stabilityPromptPreset = requireElement("#stability-prompt-preset");
const stabilityPromptHint = requireElement("#stability-prompt-hint");
const batchPromptPreset = requireElement("#batch-prompt-preset");
const batchPromptHint = requireElement("#batch-prompt-hint");
const scenarioTemplate = requireElement("#scenario-template");
const scenarioTemplateHint = requireElement("#scenario-template-hint");
const stabilityEstimate = requireElement("#stability-estimate");
const batchEstimate = requireElement("#batch-estimate");
const scenarioEstimate = requireElement("#scenario-estimate");
const stabilityProgress = requireElement("#stability-progress");
const batchProgress = requireElement("#batch-progress");
const scenarioProgress = requireElement("#scenario-progress");
const reportInsights = requireElement("#report-insights");
const plainConclusion = requireElement("#plain-conclusion");
const rankingList = requireElement("#ranking-list");
const handoffSummary = requireElement("#handoff-summary");
const handoffTemplate = requireElement("#handoff-template");
const pageHelpContent = requireElement("#page-help-content");
const manualContent = requireElement("#manual-content");
const profileCount = requireElement("#profile-count");
const requestCount = requireElement("#request-count");
const testRunCount = requireElement("#test-run-count");
const nextAction = requireElement("#next-action");
const workflowSteps = requireElements(".workflow-step");
const editionBanner = requireElement("#edition-banner");
const demoModeBanner = requireElement("#demo-mode-banner");
const missingKeyGuide = requireElement("#missing-key-guide");
const quickFailureActions = requireElement("#quick-failure-actions");
const keyModal = requireElement("#key-modal");
const keyModalForm = requireElement("#key-modal-form");
const keyModalInput = requireElement("#key-modal-input");
const keyModalCancel = requireElement("#key-modal-cancel");
const confirmAction = createConfirmDialog({
  modal: requireElement("#confirm-modal"),
  titleElement: requireElement("#confirm-modal-title"),
  messageElement: requireElement("#confirm-modal-message"),
  confirmButton: requireElement("#confirm-modal-ok"),
  cancelButton: requireElement("#confirm-modal-cancel"),
});
const keyPrompt = createKeyModal({
  modal: keyModal,
  form: keyModalForm,
  input: keyModalInput,
  cancelButton: keyModalCancel,
});
const quickFailurePanel = createQuickFailurePanel({
  container: quickFailureActions,
  getDefaultProfileId: () => quickProfileSelect.value,
  updateProfileKey,
  retryQuickTest: () => quickTestForm.requestSubmit(),
  openProfiles: () => showPage("profiles"),
  openReports: () => showPage("reports"),
  openStabilitySmoke: (profileId) => {
    if (profileId) stabilityProfileSelect.value = profileId;
    stabilityTemplate.value = "smoke";
    applyStabilityTemplate();
    showPage("stability-test");
  },
});
const profileController = createProfileController({
  state,
  profileForm,
  profileTemplate,
  demoModeBanner,
  renderProfileConfigCheck,
  loadProfiles,
  loadRequests,
  quickProfileSelect,
  quickTestResult,
  quickFailurePanel,
  showPage,
  confirmAction,
});

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    showPage(button.dataset.page);
  });
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-go-page]");
  if (!button) return;
  showPage(button.dataset.goPage);
});

requireElement("#toggle-page-help").addEventListener("click", () => {
  pageHelpContent.classList.toggle("hidden");
});
requireElement("#load-demo-data").addEventListener("click", enableDemoMode);
requireElement("#exit-demo-mode").addEventListener("click", disableDemoMode);
requireElement("#reload-profiles").addEventListener("click", loadProfiles);
requireElement("#reload-requests").addEventListener("click", async () => {
  await Promise.all([loadRequests(), loadTestRuns(), loadTaskEvents()]);
});
requireElement("#copy-stability-report").addEventListener("click", copyStabilityReport);
requireElement("#copy-scenario-report").addEventListener("click", copyLatestReport);
requireElement("#copy-handoff-template").addEventListener("click", copyHandoffTemplate);
requireElement("#refresh-handoff-template").addEventListener("click", renderDeliveryViews);
requireElement("#reload-manual").addEventListener("click", loadManual);
requireElement("#export-profiles").addEventListener("click", exportProfiles);
requireElement("#export-support-bundle").addEventListener("click", exportSupportBundle);
requireElement("#save-and-test-profile").addEventListener("click", profileController.saveAndTestProfile);
requireElement("#import-profiles-button").addEventListener("click", () => {
  requireElement("#import-profiles-file").click();
});
requireElement("#import-profiles-file").addEventListener("change", profileController.importProfiles);
requireElement("#cancel-stability-task").addEventListener("click", () => cancelRemoteTask(state, "stability"));
requireElement("#cancel-batch-task").addEventListener("click", () => cancelRemoteTask(state, "batch"));
requireElement("#cancel-scenario-task").addEventListener("click", () => cancelRemoteTask(state, "scenario"));
requireElement("#cancel-standard-task").addEventListener("click", () => cancelRemoteTask(state, "standard"));
stabilityTemplate.addEventListener("change", applyStabilityTemplate);
batchTemplate.addEventListener("change", applyBatchTemplate);
quickPromptPreset.addEventListener("change", applyQuickPromptPreset);
standardPromptPreset.addEventListener("change", applyStandardPromptPreset);
stabilityPromptPreset.addEventListener("change", applyStabilityPromptPreset);
batchPromptPreset.addEventListener("change", applyBatchPromptPreset);
scenarioTemplate.addEventListener("change", applyScenarioTemplate);
profileTemplate.addEventListener("change", applyProfileTemplate);
stabilityTestForm.addEventListener("input", updateEstimates);
batchTestForm.addEventListener("input", updateEstimates);
scenarioTestForm.addEventListener("input", updateEstimates);
profileForm.addEventListener("input", renderProfileConfigCheck);
stabilityProfileSelect.addEventListener("change", updateEstimates);
batchProfileSelect.addEventListener("change", updateEstimates);
scenarioProfileSelect.addEventListener("change", updateEstimates);
scenarioCaseSelect.addEventListener("change", updateEstimates);
hydrateProjectInfoForm();
hydratePromptPresetSelects();
renderProfileConfigCheck();

projectInfoForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.projectInfo = Object.fromEntries(new FormData(projectInfoForm).entries());
  saveProjectInfo(state.projectInfo);
  renderDeliveryViews();
  toast("本次测试信息已保存。");
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await profileController.saveProfileFromForm({ resetAfterSave: true });
    toast("API 配置已保存。");
  } catch (error) {
    toast(error.message, true);
  }
});

createQuickTestController({
  form: quickTestForm,
  resultElement: quickTestResult,
  quickFailurePanel,
  afterRequest: loadRequests,
});

createStandardEvalController({
  form: standardEvalForm,
  submitButton: standardEvalSubmit,
  plainResultElement: standardPlainResult,
  resultElement: standardEvalResult,
  nextActionsElement: standardNextActions,
  progressElement: standardEvalProgress,
  taskProgressElement: standardTaskProgress,
  state,
  estimateCost: estimateStandardCost,
  confirmRun: (title, estimate) => confirmAction(confirmExecution(title, estimate)),
  refreshResults: () => Promise.all([loadRequests(), loadTestRuns(), loadTaskEvents()]),
  setLatestReport: (report) => {
    state.latestReport = report;
  },
  showPage,
  quickProfileSelect,
  stabilityProfileSelect,
  stabilityTemplate,
  applyStabilityTemplate,
  scenarioTemplate,
  applyScenarioTemplate,
  scenarioProfileSelect,
  updateEstimates,
});

createTaskFormController({
  form: stabilityTestForm,
  submitButton: stabilitySubmit,
  resultElement: stabilitySummary,
  progressElement: stabilityProgress,
  state,
  slot: "stability",
  taskType: "stability",
  confirmRun: (payload) => confirmAction(confirmExecution("稳定性测试", estimateStabilityCost(payload))),
  preparePayload: (payload) => payload,
  beforeStart: (payload) => {
    stabilitySummary.innerHTML = `<p class="muted">正在进行 ${payload.rounds} 轮测试。请不要关闭窗口。</p>`;
    stabilityReport.textContent = "测试完成后会自动生成报告。";
  },
  onSuccess: async (result) => {
    state.latestReport = result.reportMarkdown || "";
    renderStabilitySummary(result);
    stabilityReport.textContent = result.reportMarkdown || "没有生成报告。";
    await Promise.all([loadRequests(), loadTestRuns(), loadTaskEvents()]);
    toast("稳定性测试完成。");
  },
  failurePrefix: "稳定性测试失败",
  idleButtonText: "开始稳定性测试",
});

createTaskFormController({
  form: batchTestForm,
  submitButton: batchSubmit,
  resultElement: batchTestResult,
  progressElement: batchProgress,
  state,
  slot: "batch",
  taskType: "batch-stability",
  confirmRun: (payload) => confirmAction(confirmExecution("批量并发测试", estimateBatchCost(payload))),
  preparePayload: (payload) => {
    const profileIds = requireSelectedValues(batchProfileSelect, "请至少选择一个被测 API。");
    return profileIds ? { ...payload, profileIds } : null;
  },
  beforeStart: (payload) => {
    batchTestResult.textContent = `正在测试 ${payload.profileIds.length} 个 API。测试期间可以等待，不要关闭窗口。`;
  },
  onSuccess: async (result) => {
    state.latestReport = result.reportMarkdown || "";
    batchTestResult.textContent = result.reportMarkdown || formatBatchResult(result);
    await Promise.all([loadRequests(), loadTestRuns(), loadTaskEvents()]);
    toast("批量测试完成。");
  },
  failurePrefix: "批量测试失败",
  idleButtonText: "开始批量测试",
});

createTaskFormController({
  form: scenarioTestForm,
  submitButton: scenarioSubmit,
  resultElement: scenarioTestResult,
  progressElement: scenarioProgress,
  state,
  slot: "scenario",
  taskType: "scenario",
  confirmRun: (payload) => confirmAction(confirmExecution("复杂场景测试", estimateScenarioCost(payload, state.scenarios))),
  preparePayload: (payload) => {
    const profileIds = requireSelectedValues(scenarioProfileSelect, "请至少选择一个被测 API。");
    if (!profileIds) return null;
    const scenarioIds = requireSelectedValues(scenarioCaseSelect, "请至少选择一个测试场景。");
    return scenarioIds ? { ...payload, profileIds, scenarioIds } : null;
  },
  beforeStart: (payload) => {
    scenarioTestResult.textContent = `正在测试 ${payload.profileIds.length} 个 API、${payload.scenarioIds.length} 个场景。复杂场景耗时较长，请等待。`;
  },
  onSuccess: async (result) => {
    state.latestReport = result.reportMarkdown || "";
    scenarioTestResult.textContent = result.reportMarkdown || formatScenarioResult(result);
    await Promise.all([loadRequests(), loadTestRuns(), loadTaskEvents()]);
    toast("场景测试完成。");
  },
  failurePrefix: "场景测试失败",
  idleButtonText: "开始场景测试",
});

await Promise.all([loadHealth(), loadProfiles(), loadScenarios(), loadRequests(), loadTestRuns(), loadTaskEvents()]);
renderPageHelp("dashboard");

function showPage(page) {
  navButtons.forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  pages.forEach((item) => item.classList.toggle("active", item.id === page));
  renderPageHelp(page);
  if (page === "manual" && !state.manualLoaded) {
    loadManual();
  }
}

async function loadProfiles() {
  if (state.demoMode) {
    renderProfiles();
    renderProfileOptions();
    renderDashboard();
    updateEstimates();
    return;
  }
  state.profiles = await api("/api/profiles");
  renderProfiles();
  renderProfileOptions();
  renderDashboard();
  updateEstimates();
}

async function loadScenarios() {
  state.scenarios = await api("/api/scenarios");
  renderScenarioOptions();
  applyScenarioTemplate();
  updateEstimates();
}

async function loadHealth() {
  state.health = await api("/api/health");
  renderEditionBanner();
}

function renderEditionBanner() {
  const safetyEnabled = Boolean(state.health?.safetyScenariosEnabled);
  editionBanner.classList.toggle("hidden", !safetyEnabled);
  editionBanner.innerHTML = safetyEnabled
    ? `<strong>内部风控版</strong>已启用内容安全合规测试。请只由负责人或受训测试人员使用。`
    : "";
}

async function loadManual() {
  manualContent.innerHTML = `<p class="muted">正在加载使用手册...</p>`;
  try {
    const response = await fetch("/docs/USER_MANUAL.md");
    if (!response.ok) {
      throw new Error("无法读取 docs/USER_MANUAL.md");
    }
    const markdown = await response.text();
    manualContent.innerHTML = renderMarkdown(markdown);
    state.manualLoaded = true;
  } catch (error) {
    manualContent.innerHTML = `<p class="fail">手册加载失败：${escapeHtml(error.message)}</p>`;
  }
}

async function loadRequests() {
  if (state.demoMode) {
    renderRequests();
    renderDashboard();
    renderDeliveryViews();
    return;
  }
  state.requests = await api("/api/requests/recent");
  renderRequests();
  renderDashboard();
  renderDeliveryViews();
}

async function loadTestRuns() {
  if (state.demoMode) {
    renderTestRuns();
    renderDashboard();
    renderDeliveryViews();
    return;
  }
  state.testRuns = await api("/api/test-runs/recent");
  renderTestRuns();
  renderDashboard();
  renderDeliveryViews();
}

async function loadTaskEvents() {
  if (state.demoMode) {
    renderTaskEvents();
    renderDeliveryViews();
    return;
  }
  state.taskEvents = await api("/api/tasks/recent");
  renderTaskEvents();
  renderDeliveryViews();
}

function renderPageHelp(page) {
  renderPageHelpPanel(pageHelpContent, page);
}

function enableDemoMode() {
  const demoData = buildDemoData();
  state.demoMode = true;
  state.profiles = demoData.profiles.map((item) => ({ ...item }));
  state.requests = demoData.requests.map((item) => ({ ...item }));
  state.testRuns = demoData.testRuns.map((item) => ({ ...item }));
  state.taskEvents = demoData.taskEvents.map((item) => ({ ...item }));
  demoModeBanner.classList.remove("hidden");
  renderProfiles();
  renderProfileOptions();
  renderRequests();
  renderTestRuns();
  renderTaskEvents();
  renderDashboard();
  renderDeliveryViews();
  showPage("reports");
  toast("已进入演示模式，不会发起真实请求。");
}

async function disableDemoMode() {
  state.demoMode = false;
  demoModeBanner.classList.add("hidden");
  await Promise.all([loadProfiles(), loadRequests(), loadTestRuns(), loadTaskEvents()]);
  showPage("dashboard");
  toast("已退出演示模式，恢复本机真实数据。");
}

function renderDashboard() {
  profileCount.textContent = String(state.profiles.length);
  requestCount.textContent = String(state.requests.length);
  testRunCount.textContent = String(state.testRuns.length);
  renderWorkflowGuide();
}

function renderWorkflowGuide() {
  const status = buildWorkflowStatus(state);
  const next = getNextWorkflowStep(status);

  nextAction.innerHTML = renderNextActionHtml(next);
  nextAction.querySelector("[data-go-page]").addEventListener("click", () => showPage(next.page));

  workflowSteps.forEach((step) => {
    const key = step.dataset.step;
    step.classList.toggle("done", Boolean(status[key]));
    step.classList.toggle("current", key === next.step);
  });
}

function renderProfiles() {
  renderMissingKeyGuide();
  renderProfileList({
    profiles: state.profiles,
    list: profileList,
    onFocusForm: () => {
      profileForm.scrollIntoView({ behavior: "smooth", block: "start" });
      profileForm.elements.name.focus();
    },
    onDeleteProfile: async (profileId) => {
      const confirmed = await confirmAction({
        title: "删除这个 API 配置？",
        message: "删除后，这个配置不会再出现在测试列表里。",
        detail: "如果只是 Key 失效，建议优先更新 Key，不一定要删除配置。",
        confirmLabel: "确认删除",
        cancelLabel: "保留配置",
        tone: "danger",
      });
      if (!confirmed) {
        return;
      }
      await api(`/api/profiles/${encodeURIComponent(profileId)}`, {
        method: "DELETE",
      });
      await loadProfiles();
    },
    onUpdateKey: updateProfileKey,
  });
}

function renderMissingKeyGuide() {
  renderMissingKeyPanel({
    profiles: state.profiles,
    container: missingKeyGuide,
    onFillKey: updateProfileKey,
  });
}

async function updateProfileKey(profileId) {
  if (state.demoMode) {
    toast("演示模式不能保存 Key。请退出演示模式后再操作。", true);
    return;
  }
  const apiKey = await keyPrompt.requestApiKey();
  if (!apiKey) {
    return;
  }
  await api(`/api/profiles/${encodeURIComponent(profileId)}/key`, {
    method: "POST",
    body: JSON.stringify({ apiKey }),
  });
  await loadProfiles();
  toast("Key 已更新。建议马上跑一次快速测试。");
}

function renderProfileOptions() {
  renderProfileSelectOptions({
    profiles: state.profiles,
    selects: [standardProfileSelect, quickProfileSelect, stabilityProfileSelect, batchProfileSelect, scenarioProfileSelect],
  });
}

function renderScenarioOptions() {
  syncScenarioTemplateAvailability();
  if (state.scenarios.length === 0) {
    scenarioCaseSelect.innerHTML = `<option value="">暂无测试场景</option>`;
    return;
  }

  scenarioCaseSelect.innerHTML = state.scenarios
    .map(
      (scenario) =>
        `<option value="${scenario.id}" selected>${escapeHtml(scenario.name)} / ${escapeHtml(scenario.difficulty)}</option>`,
    )
    .join("");
}

function syncScenarioTemplateAvailability() {
  const hasSafetyScenarios = state.scenarios.some((scenario) => scenario.category === "safety");
  const safetyOption = scenarioTemplate.querySelector('option[value="scenario-safety"]');
  if (!safetyOption) return;
  safetyOption.hidden = !hasSafetyScenarios;
  safetyOption.disabled = !hasSafetyScenarios;
  if (!hasSafetyScenarios && scenarioTemplate.value === "scenario-safety") {
    scenarioTemplate.value = "scenario-basic";
  }
}

function renderRequests() {
  renderRequestList({ requests: state.requests, container: requestList });
}

function renderTestRuns() {
  renderTestRunList({ runs: state.testRuns, container: testRunList });
  renderDeliveryViews();
}

function renderTaskEvents() {
  renderTaskEventList({ tasks: state.taskEvents, container: taskEventList });
}

function renderDeliveryViews() {
  renderDeliveryPanels({
    state,
    plainConclusion,
    projectInfoSummary,
    reportInsights,
    rankingList,
    handoffSummary,
    handoffTemplate,
  });
}

function renderStabilitySummary(result) {
  renderStabilitySummaryPanel(stabilitySummary, result);
}

function renderProfileConfigCheck(validation = null) {
  renderProfileConfigCheckPanel({
    form: profileForm,
    container: profileCheckResult,
    validation,
  });
}

async function copyStabilityReport() {
  await copyLatestReport();
}

async function copyLatestReport() {
  if (!state.latestReport) {
    toast("当前没有可复制的报告。", true);
    return;
  }

  await copyText(state.latestReport);
  toast("报告已复制。");
}

async function copyHandoffTemplate() {
  const text = handoffTemplate?.textContent || "";
  if (!text.trim() || text.includes("等待生成")) {
    toast("当前没有可复制的交付模板。", true);
    return;
  }
  await copyText(text);
  toast("交付模板已复制。");
}

function applyStabilityTemplate() {
  applyStabilityTemplateToForm({
    form: stabilityTestForm,
    template: stabilityTemplate,
    updateEstimates,
  });
}

function applyBatchTemplate() {
  applyBatchTemplateToForm({
    form: batchTestForm,
    template: batchTemplate,
    updateEstimates,
  });
}

function applyQuickPromptPreset() {
  applyPromptPresetToForm({
    kind: "quick",
    form: quickTestForm,
    select: quickPromptPreset,
    hint: quickPromptHint,
  });
}

function applyStandardPromptPreset() {
  applyPromptPresetToForm({
    kind: "standard",
    form: standardEvalForm,
    select: standardPromptPreset,
    hint: standardPromptHint,
    updateEstimates,
  });
}

function applyStabilityPromptPreset() {
  applyPromptPresetToForm({
    kind: "stability",
    form: stabilityTestForm,
    select: stabilityPromptPreset,
    hint: stabilityPromptHint,
    updateEstimates,
  });
}

function applyBatchPromptPreset() {
  applyPromptPresetToForm({
    kind: "batch",
    form: batchTestForm,
    select: batchPromptPreset,
    hint: batchPromptHint,
    updateEstimates,
  });
}

function applyScenarioTemplate() {
  applyScenarioTemplateToForm({
    form: scenarioTestForm,
    template: scenarioTemplate,
    scenarios: state.scenarios,
    scenarioSelect: scenarioCaseSelect,
    hint: scenarioTemplateHint,
    updateEstimates,
  });
}

function applyProfileTemplate() {
  applyProfileTemplateToForm({
    form: profileForm,
    templateSelect: profileTemplate,
    onApplied: (template) => {
      renderProfileConfigCheck();
      toast(`已应用配置模板：${template.label}`);
    },
  });
}

function hydrateProjectInfoForm() {
  hydrateProjectInfoFormFields(projectInfoForm, state.projectInfo);
  renderDeliveryViews();
}

function hydratePromptPresetSelects() {
  quickPromptPreset.innerHTML = renderPromptPresetOptions("quick", "connectivity");
  standardPromptPreset.innerHTML = renderPromptPresetOptions("standard", "default");
  stabilityPromptPreset.innerHTML = renderPromptPresetOptions("stability", "basic");
  batchPromptPreset.innerHTML = renderPromptPresetOptions("batch", "fair-basic");
  applyQuickPromptPreset();
  applyStandardPromptPreset();
  applyStabilityPromptPreset();
  applyBatchPromptPreset();
}

function updateEstimates() {
  updateEstimateLabels({
    stabilityForm: stabilityTestForm,
    stabilityEstimate,
    batchForm: batchTestForm,
    batchProfileSelect,
    batchEstimate,
    scenarioForm: scenarioTestForm,
    scenarioProfileSelect,
    scenarioCaseSelect,
    scenarioEstimate,
    scenarios: state.scenarios,
  });
}

async function exportProfiles() {
  const data = await api("/api/profiles/export");
  downloadText(`nexusapi-profiles-${Date.now()}.json`, JSON.stringify(data, null, 2));
  toast("配置已导出，导出文件不包含 API Key。");
}

async function exportSupportBundle() {
  try {
    const data = await api("/api/support-bundle");
    downloadText(`nexusapi-support-${Date.now()}.json`, JSON.stringify(data, null, 2));
    toast("问题包已导出。可以把这个文件发给负责人，里面不包含 API Key。");
  } catch (error) {
    toast(`问题包导出失败：${error.message}`, true);
  }
}
