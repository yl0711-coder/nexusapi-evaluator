import { average, escapeHtml, formatDateTime } from "./client-utils.js";
import { formatTaskStatus, formatTaskType, recommendationClass, taskStatusClass } from "./formatters.js";

export function renderRequestList({ requests, container }) {
  if (requests.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>还没有跑过测试</strong>
        <p>请求记录会在快速测试、稳定性测试或场景测试后出现。建议先跑一次快速测试。</p>
        <button class="primary" type="button" data-go-page="quick-test">去快速测试</button>
      </div>
    `;
    return;
  }

  container.innerHTML = requests
    .map(
      (request) => `
        <div class="row request-row">
          <div>
            <strong>${escapeHtml(request.profileName)}</strong><br />
            <small>${escapeHtml(request.model)}</small>
          </div>
          <span class="${request.success ? "ok" : "fail"}">${request.success ? "成功" : "失败"}</span>
          <span>${request.statusCode ?? "-"}</span>
          <span>${request.firstByteMs ?? "-"} ms</span>
          <span>${request.totalMs ?? "-"} ms</span>
          <small>${escapeHtml(request.normalizedError || request.responseSummary || "-")}</small>
        </div>
      `,
    )
    .join("");
}

export function renderTestRunList({ runs, container }) {
  if (runs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>还没有正式测试报告</strong>
        <p>快速测试成功后，再跑标准评测或 3 轮稳定性测试，这里就会出现报告。</p>
        <button class="primary" type="button" data-go-page="standard-eval">去标准评测</button>
      </div>
    `;
    return;
  }

  container.innerHTML = runs.map((run) => renderTestRunRow(run)).join("");
}

export function renderTaskEventList({ tasks, container }) {
  if (tasks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>还没有长任务记录</strong>
        <p>稳定性、批量或场景测试开始后，这里会记录任务进度、完成、取消或失败。</p>
        <button class="secondary" type="button" data-go-page="stability-test">去稳定性测试</button>
      </div>
    `;
    return;
  }

  container.innerHTML = tasks
    .map(
      (task) => `
        <div class="row task-row">
          <div>
            <strong>${escapeHtml(formatTaskType(task.type))}</strong><br />
            <small>${escapeHtml(formatDateTime(task.startedAt || task.createdAt))}</small>
          </div>
          <span class="${taskStatusClass(task.status)}">${escapeHtml(formatTaskStatus(task.status))}</span>
          <span>${task.progress ?? 0}%</span>
          <span>${task.completedUnits ?? 0}/${task.totalUnits ?? "-"}</span>
          <small>${escapeHtml(task.message || "-")}</small>
          <small>${escapeHtml(task.error || task.result?.reportPath || task.result?.reportHtmlPath || "-")}</small>
        </div>
      `,
    )
    .join("");
}

function renderTestRunRow(run) {
  if (run.type === "scenario") {
    const avgScore = Math.round(
      average(run.results?.map((item) => item.avgQualityScore).filter((value) => Number.isFinite(value)) || []) || 0,
    );
    return `
      <div class="row test-run-row">
        <div>
          <strong>场景测试</strong><br />
          <small>${run.profileCount} 个 API / ${run.scenarioCount} 个场景</small>
        </div>
        <span class="tag">复杂场景</span>
        <span>重复 ${run.repeats} 次</span>
        <span>质量 ${avgScore}</span>
        <small>并发 API ${run.maxParallelProfiles} / 单 API ${run.requestConcurrency}</small>
        <small>${escapeHtml(formatDateTime(run.startedAt))}</small>
      </div>
    `;
  }

  return `
    <div class="row test-run-row">
      <div>
        <strong>${escapeHtml(run.profileName)}</strong><br />
        <small>${escapeHtml(run.model)}</small>
      </div>
      <span class="${recommendationClass(run.recommendation?.level)}">${escapeHtml(run.successRateText)}</span>
      <span>${run.rounds} 轮 / 并发 ${run.concurrency}</span>
      <span>慢请求 ${run.p95TotalMs ?? "-"} ms</span>
      <small>${escapeHtml(run.recommendation?.title || "-")}</small>
      <small>${escapeHtml(formatDateTime(run.startedAt))}</small>
    </div>
  `;
}
