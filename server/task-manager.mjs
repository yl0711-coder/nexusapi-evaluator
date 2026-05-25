import crypto from "node:crypto";
import { appendJsonLine, clampNumber, summarizeText } from "./utils.mjs";

// Owns remote task lifecycle only. It does not know how a stability or scenario
// test works; callers inject runners so task state can be tested independently.
export function createTaskManager({
  taskEventsFile,
  errorLogFile,
  runStabilityTest,
  runBatchStabilityTest,
  runScenarioTest,
  normalizeProfileIds,
  normalizeScenarioIds,
  logTechnicalError,
  buildUserErrorMessage,
}) {
  const tasks = new Map();

  async function createTask(type, payload) {
    const task = {
      id: crypto.randomUUID(),
      type: normalizeTaskType(type),
      status: "running",
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      progress: 0,
      completedUnits: 0,
      totalUnits: estimateTaskUnits(type, payload, { normalizeProfileIds, normalizeScenarioIds }),
      message: "任务已开始。",
      cancelRequested: false,
      result: null,
      error: null,
      errorId: "",
    };
    tasks.set(task.id, task);
    await appendTaskEvent(taskEventsFile, task, "started", {
      payload: summarizeTaskPayload(task.type, payload, { normalizeProfileIds, normalizeScenarioIds }),
    });
    // Run in the background so HTTP handlers can return 202 immediately.
    void runTask(task, payload);
    return task;
  }

  async function runTask(task, payload) {
    const context = { task };
    try {
      let result;
      if (task.type === "stability") {
        result = await runStabilityTest(payload, context);
      } else if (task.type === "batch-stability") {
        result = await runBatchStabilityTest(payload, context);
      } else if (task.type === "scenario") {
        result = await runScenarioTest(payload, context);
      } else {
        throw new Error("不支持的任务类型。");
      }

      if (task.cancelRequested) {
        task.status = "cancelled";
        task.message = "任务已取消。";
        await appendTaskEvent(taskEventsFile, task, "cancelled");
      } else {
        task.status = "completed";
        task.progress = 100;
        task.completedUnits = task.totalUnits || task.completedUnits;
        task.message = "任务已完成。";
        task.result = result;
        await appendTaskEvent(taskEventsFile, task, "completed", { result: summarizeTaskResult(result) });
      }
    } catch (error) {
      if (task.cancelRequested || error?.name === "TaskCancelledError") {
        task.status = "cancelled";
        task.message = "任务已取消。";
        await appendTaskEvent(taskEventsFile, task, "cancelled");
      } else {
        task.errorId = logTechnicalError
          ? await logTechnicalError(errorLogFile, {
              source: "task",
              error,
              context: {
                taskId: task.id,
                taskType: task.type,
                progress: task.progress,
                completedUnits: task.completedUnits,
                totalUnits: task.totalUnits,
              },
            })
          : "";
        task.error = buildUserErrorMessage && task.errorId ? buildUserErrorMessage(task.errorId) : "任务执行失败，请查看本地错误日志。";
        task.status = "failed";
        task.message = task.error;
        await appendTaskEvent(taskEventsFile, task, "failed", { errorId: task.errorId });
      }
    } finally {
      task.endedAt = new Date().toISOString();
      // Keep finished tasks queryable for a while, but do not keep the Node
      // process alive only because of this cleanup timer.
      const cleanupTimer = setTimeout(() => tasks.delete(task.id), 1000 * 60 * 60);
      cleanupTimer.unref?.();
    }
  }

  async function cancelTask(task) {
    task.cancelRequested = true;
    task.message = "已请求取消，当前请求结束后会停止。";
    await appendTaskEvent(taskEventsFile, task, "cancel_requested");
  }

  return {
    tasks,
    createTask,
    cancelTask,
    getTask: (taskId) => tasks.get(taskId),
    publicTask,
  };
}

export function normalizeTaskType(type) {
  if (type === "stability" || type === "batch-stability" || type === "scenario") {
    return type;
  }
  throw new Error("不支持的任务类型。");
}

export function estimateTaskUnits(type, payload, { normalizeProfileIds, normalizeScenarioIds }) {
  if (type === "stability") {
    return clampNumber(payload.rounds, 1, 100, 10);
  }
  if (type === "batch-stability") {
    return normalizeProfileIds(payload.profileIds).length || 1;
  }
  if (type === "scenario") {
    const profileCount = Math.max(1, normalizeProfileIds(payload.profileIds).length);
    const scenarioCount = Math.max(1, normalizeScenarioIds(payload.scenarioIds).length);
    return profileCount * scenarioCount * clampNumber(payload.repeats, 1, 5, 1);
  }
  return 1;
}

export function publicTask(task) {
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    progress: task.progress,
    completedUnits: task.completedUnits,
    totalUnits: task.totalUnits,
    message: task.message,
    cancelRequested: task.cancelRequested,
    result: task.result,
    error: task.error,
    errorId: task.errorId || "",
  };
}

export async function appendTaskEvent(taskEventsFile, task, event, extra = {}) {
  await appendJsonLine(taskEventsFile, {
    taskId: task.id,
    type: task.type,
    event,
    status: task.status,
    progress: task.progress,
    completedUnits: task.completedUnits,
    totalUnits: task.totalUnits,
    message: task.message,
    error: task.error,
    errorId: task.errorId || extra.errorId || "",
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    loggedAt: new Date().toISOString(),
    ...extra,
  });
}

export function summarizeTaskPayload(type, payload, { normalizeProfileIds, normalizeScenarioIds }) {
  if (type === "stability") {
    return {
      profileId: payload.profileId || "",
      rounds: clampNumber(payload.rounds, 1, 100, 10),
      concurrency: clampNumber(payload.concurrency, 1, 5, 1),
      promptPreview: summarizeTaskPrompt(payload.prompt || ""),
    };
  }
  if (type === "batch-stability") {
    return {
      profileCount: normalizeProfileIds(payload.profileIds).length,
      rounds: clampNumber(payload.rounds, 1, 100, 10),
      maxParallelProfiles: clampNumber(payload.maxParallelProfiles, 1, 5, 2),
      concurrency: clampNumber(payload.concurrency, 1, 5, 1),
      promptPreview: summarizeTaskPrompt(payload.prompt || ""),
    };
  }
  if (type === "scenario") {
    return {
      profileCount: normalizeProfileIds(payload.profileIds).length,
      scenarioCount: normalizeScenarioIds(payload.scenarioIds).length,
      repeats: clampNumber(payload.repeats, 1, 5, 1),
      maxParallelProfiles: clampNumber(payload.maxParallelProfiles, 1, 5, 2),
      requestConcurrency: clampNumber(payload.requestConcurrency || payload.concurrency, 1, 3, 1),
    };
  }
  return {};
}

export function summarizeTaskResult(result) {
  if (!result || typeof result !== "object") {
    return {};
  }
  if (result.type === "scenario" || result.runId?.startsWith?.("scenario-")) {
    return {
      runId: result.runId,
      profileCount: result.profileCount,
      scenarioCount: result.scenarioCount,
      reportPath: result.reportPath,
      reportHtmlPath: result.reportHtmlPath,
    };
  }
  if (result.batchId) {
    return {
      batchId: result.batchId,
      profileCount: result.profileCount,
      rounds: result.rounds,
      reportPath: result.reportPath,
      reportHtmlPath: result.reportHtmlPath,
    };
  }
  return {
    runId: result.runId,
    profileName: result.profileName,
    successRateText: result.successRateText,
    p95TotalMs: result.p95TotalMs,
    reportPath: result.reportPath,
    reportHtmlPath: result.reportHtmlPath,
  };
}

export function updateTaskProgress(taskContext, completedUnits, totalUnits, message) {
  const task = taskContext?.task;
  if (!task || task.status !== "running") {
    return;
  }
  task.completedUnits = Math.max(task.completedUnits || 0, Number(completedUnits) || 0);
  task.totalUnits = Math.max(task.totalUnits || 1, Number(totalUnits) || 1);
  task.progress = Math.min(99, Math.round((task.completedUnits / task.totalUnits) * 100));
  task.message = message || task.message;
}

function summarizeTaskPrompt(prompt) {
  // Task events are operational logs. They may include prompt previews, but
  // they must never expose obvious API key patterns.
  return summarizeText(String(prompt)).replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[redacted-key]");
}

export function assertTaskNotCancelled(taskContext) {
  if (!taskContext?.task?.cancelRequested) {
    return;
  }
  const error = new Error("任务已取消。");
  error.name = "TaskCancelledError";
  throw error;
}
