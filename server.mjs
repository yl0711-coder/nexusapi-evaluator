import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { MIME_TYPES, TEST_SCENARIOS } from "./server/constants.mjs";
import { DOCS_ROOT, ERROR_LOG_FILE, STATIC_ROOT, TASK_EVENTS_FILE } from "./server/paths.mjs";
import { ensureDataDir, readRecentErrors, readRecentRequests, readRecentTasks, readRecentTestRuns } from "./server/data-store.mjs";
import { buildUserErrorMessage, logTechnicalError } from "./server/error-log.mjs";
import { isAllowedBrowserOrigin, staticSecurityHeaders } from "./server/http-security.mjs";
import { HttpRequestError, readJson } from "./server/http-request.mjs";
import {
  exportProfile,
  loadProfiles,
  maskProfile,
  maskScenario,
  mergeProfiles,
  normalizeImportedProfiles,
  normalizeProfile,
  saveProfiles,
} from "./server/profile-store.mjs";
import { deleteProfileApiKey, saveProfileApiKey } from "./server/secret-store.mjs";
import { createTaskManager } from "./server/task-manager.mjs";
import { buildSupportBundle } from "./server/support-bundle.mjs";
import {
  normalizeProfileIds,
  normalizeScenarioIds,
  runBatchStabilityTest,
  runQuickTest,
  runScenarioTest,
  runStabilityTest,
} from "./server/test-runner.mjs";
import { getRawRequestPathname, resolveRequestPathInside } from "./server/static-paths.mjs";
import { hasProxyEnv, requiredString, safeJson, sendJson } from "./server/utils.mjs";

const PORT = Number(process.env.API_PORT || process.env.PORT || 5180);
const taskManager = createTaskManager({
  taskEventsFile: TASK_EVENTS_FILE,
  runStabilityTest,
  runBatchStabilityTest,
  runScenarioTest,
  normalizeProfileIds,
  normalizeScenarioIds,
  errorLogFile: ERROR_LOG_FILE,
  logTechnicalError,
  buildUserErrorMessage,
});

await ensureDataDir();

createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/api/")) {
      if (!isAllowedBrowserOrigin(req.headers.origin)) {
        sendJson(res, 403, {
          error: "forbidden_origin",
          userMessage: "请求来源不被允许。请从本工具窗口内操作。",
        });
        return;
      }
      await handleApi(req, res);
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    if (error instanceof HttpRequestError) {
      sendJson(res, error.status, {
        error: error.code,
        userMessage: error.userMessage,
      });
      return;
    }

    const errorId = await logErrorSafely({
      source: "server",
      error,
      context: {
        method: req.method,
        url: req.url,
      },
    });
    sendJson(res, 500, {
      error: "internal_error",
      userMessage: buildUserErrorMessage(errorId),
      errorId,
    });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`NexusAPI Evaluator MVP: http://127.0.0.1:${PORT}`);
});

async function handleApi(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === "OPTIONS") {
    sendJson(res, 204, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "nexusapi-evaluator-api",
      pid: process.pid,
      proxyEnvDetected: hasProxyEnv(),
      safetyScenariosEnabled: TEST_SCENARIOS.some((scenario) => scenario.category === "safety"),
      version: "0.1.0",
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/client-errors") {
    const body = await readJson(req);
    const errorId = await logTechnicalError(ERROR_LOG_FILE, {
      source: "client",
      error: body.message || body.error || "client_error",
      context: {
        page: body.page || "",
        kind: body.kind || "",
        stack: body.stack || "",
        details: body.details || {},
      },
    });
    sendJson(res, 200, { ok: true, errorId });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/profiles") {
    const profiles = await loadProfiles();
    sendJson(res, 200, profiles.map(maskProfile));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/profiles/export") {
    const profiles = await loadProfiles();
    sendJson(res, 200, {
      exportedAt: new Date().toISOString(),
      version: 1,
      profiles: profiles.map(exportProfile),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/scenarios") {
    sendJson(res, 200, TEST_SCENARIOS.map(maskScenario));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/profiles") {
    const body = await readJson(req);
    const profiles = await loadProfiles();
    const existing = profiles.find((item) => item.id === body.id);
    const profile = await normalizeProfile(body, existing);
    const index = profiles.findIndex((item) => item.id === profile.id);
    if (index >= 0) {
      profiles[index] = profile;
    } else {
      profiles.push(profile);
    }
    await saveProfiles(profiles);
    sendJson(res, 200, maskProfile(profile));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/profiles/import") {
    const body = await readJson(req);
    const profiles = await loadProfiles();
    const importedProfiles = await normalizeImportedProfiles(body, profiles);
    const merged = mergeProfiles(profiles, importedProfiles);
    await saveProfiles(merged);
    sendJson(res, 200, { ok: true, imported: importedProfiles.length, total: merged.length });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/profiles/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/profiles/", ""));
    const profiles = await loadProfiles();
    const profile = profiles.find((item) => item.id === id);
    if (profile) {
      await deleteProfileApiKey(profile);
    }
    await saveProfiles(profiles.filter((profile) => profile.id !== id));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/profiles/") && url.pathname.endsWith("/key")) {
    const id = decodeURIComponent(url.pathname.replace("/api/profiles/", "").replace("/key", ""));
    const body = await readJson(req);
    const apiKey = requiredString(body.apiKey, "API Key");
    const profiles = await loadProfiles();
    const index = profiles.findIndex((profile) => profile.id === id);
    if (index < 0) {
      sendJson(res, 404, { error: "profile_not_found", message: "没有找到 API 配置。" });
      return;
    }
    const keyInfo = await saveProfileApiKey(id, apiKey);
    profiles[index] = {
      ...profiles[index],
      apiKeyRef: keyInfo.ref,
      keyStorage: keyInfo.storage,
      hasKey: true,
      updatedAt: new Date().toISOString(),
    };
    await saveProfiles(profiles);
    sendJson(res, 200, maskProfile(profiles[index]));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tests/quick") {
    const body = await readJson(req);
    const result = await runQuickTest(body.profileId, body.prompt || "");
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tests/stability") {
    const body = await readJson(req);
    const result = await runStabilityTest(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tests/batch-stability") {
    const body = await readJson(req);
    const result = await runBatchStabilityTest(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tests/scenario") {
    const body = await readJson(req);
    const result = await runScenarioTest(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tasks") {
    const body = await readJson(req);
    const task = await taskManager.createTask(body.type, body.payload || {});
    sendJson(res, 202, taskManager.publicTask(task));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/tasks/recent") {
    sendJson(res, 200, await readRecentTasks(taskManager.tasks, taskManager.publicTask));
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/tasks/")) {
    const taskId = decodeURIComponent(url.pathname.replace("/api/tasks/", "").replace("/cancel", ""));
    const task = taskManager.getTask(taskId);
    if (!task) {
      sendJson(res, 404, { error: "task_not_found", message: "没有找到测试任务。" });
      return;
    }
    sendJson(res, 200, taskManager.publicTask(task));
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/tasks/") && url.pathname.endsWith("/cancel")) {
    const taskId = decodeURIComponent(url.pathname.replace("/api/tasks/", "").replace("/cancel", ""));
    const task = taskManager.getTask(taskId);
    if (!task) {
      sendJson(res, 404, { error: "task_not_found", message: "没有找到测试任务。" });
      return;
    }
    await taskManager.cancelTask(task);
    sendJson(res, 200, taskManager.publicTask(task));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/requests/recent") {
    sendJson(res, 200, await readRecentRequests());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/test-runs/recent") {
    sendJson(res, 200, await readRecentTestRuns());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/support-bundle") {
    const profiles = await loadProfiles();
    const requests = await readRecentRequests();
    const testRuns = await readRecentTestRuns();
    const tasks = await readRecentTasks(taskManager.tasks, taskManager.publicTask);
    const errors = await readRecentErrors();
    sendJson(res, 200, buildSupportBundle({ profiles, requests, testRuns, tasks, errors }));
    return;
  }

  sendJson(res, 404, { error: "not_found" });
}

async function logErrorSafely(entry) {
  try {
    return await logTechnicalError(ERROR_LOG_FILE, entry);
  } catch (error) {
    console.error("failed to write technical error log", error);
    return "err-log-write-failed";
  }
}

async function serveStatic(req, res) {
  const rawPathname = getRawRequestPathname(req.url);
  const requestedPath = rawPathname === "/" ? "/index.html" : rawPathname;
  const staticPath = resolveRequestPathInside(STATIC_ROOT, requestedPath);
  if (!staticPath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(staticPath);
    res.writeHead(200, {
      "content-type": MIME_TYPES[extname(staticPath)] || "application/octet-stream",
      ...staticSecurityHeaders(staticPath),
    });
    res.end(content);
    return;
  } catch {
    if (!requestedPath.startsWith("/docs/")) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
  }

  const docsPath = resolveRequestPathInside(DOCS_ROOT, requestedPath.replace(/^\/docs\/?/, "/"));
  if (!docsPath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(docsPath);
    res.writeHead(200, {
      "content-type": MIME_TYPES[extname(docsPath)] || "application/octet-stream",
      ...staticSecurityHeaders(docsPath),
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}
