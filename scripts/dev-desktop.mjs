import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { isProtectedPort as isProtectedPortValue, readProtectedPorts } from "./port-policy.mjs";

const devConfig = loadDevConfig();
let API_PORT = readPort("API_PORT", devConfig.apiPort, 5180);
let VITE_PORT = readPort("VITE_PORT", devConfig.vitePort, 5179);
const PORT_MODE = readPortMode(devConfig.portMode);
const PROTECTED_PORTS = readProtectedPorts(devConfig.protectedPorts);
const SHOW_TECHNICAL_PORT_DETAILS = readBooleanFlag("SHOW_TECHNICAL_PORT_DETAILS", devConfig.showTechnicalPortDetails);
const children = [];
const execFileAsync = promisify(execFile);
let shuttingDown = false;

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
process.on("SIGHUP", () => shutdown(129));
process.on("uncaughtException", async (error) => {
  console.error(error);
  await shutdown(1);
});
process.on("unhandledRejection", async (error) => {
  console.error(error);
  await shutdown(1);
});
process.on("exit", () => terminateChildren("SIGTERM"));

await ensureApiServer();
await ensureFrontendServer();
const tauriConfig = JSON.stringify({
  build: {
    beforeDevCommand: "",
    devUrl: `http://127.0.0.1:${VITE_PORT}`,
  },
});
const tauri = start("cargo", ["tauri", "dev", "--config", tauriConfig], "desktop");
const exitCode = await waitForExit(tauri);
await shutdown(exitCode);

async function ensureApiServer() {
  API_PORT = await ensurePortAllowed("API service", API_PORT, "API_PORT");
  const health = await getApiHealth();
  if (health?.ok && health.service === "nexusapi-evaluator-api" && !health.proxyEnvDetected) {
    console.log(`本地 API 服务已可用：127.0.0.1:${API_PORT}。`);
    return;
  }
  if (health?.ok && health.proxyEnvDetected) {
    console.log(`端口 ${API_PORT} 上有旧的评测服务，但它带着代理环境启动。`);
    API_PORT = await handlePortConflict("API service", API_PORT, "API_PORT");
    return ensureApiServer();
  }
  if (health?.ok) {
    API_PORT = await handlePortConflict("API service", API_PORT, "API_PORT");
    return ensureApiServer();
  }
  if (!(await canBindPort(API_PORT))) {
    API_PORT = await handlePortConflict("API service", API_PORT, "API_PORT");
  }

  start("pnpm", ["dev:server"], "api", [API_PORT]);
  await waitForApiReady();
}

async function ensureFrontendServer() {
  VITE_PORT = await ensurePortAllowed("Frontend dev server", VITE_PORT, "VITE_PORT");
  if (await isFrontendReady()) {
    console.log(`前端页面已可用：127.0.0.1:${VITE_PORT}。`);
    return;
  }

  if (!(await canBindPort(VITE_PORT))) {
    VITE_PORT = await handlePortConflict("Frontend dev server", VITE_PORT, "VITE_PORT");
  }

  start("pnpm", ["dev"], "frontend", [VITE_PORT]);
  await waitForFrontendReady();
}

async function handlePortConflict(label, port, envName) {
  const protectedPort = isProtectedPort(port);
  // Protected ports may belong to VPN/proxy software. Do not inspect or touch
  // them more than necessary; just choose another port or ask the user.
  const processes = protectedPort ? [] : await findListeningProcesses(port);
  const suggestions = await suggestFreePorts(port);
  console.log(`${formatServiceLabel(label)}端口 ${port} 当前不可用。`);
  if (protectedPort) {
    console.log("这个端口在保护清单里，通常用于 VPN、代理或其他重要本机服务。");
  } else if (processes.length > 0) {
    console.log("检测到这个端口已经被下面的本机程序使用：");
    for (const processInfo of processes) {
      console.log(`- PID ${processInfo.pid}: ${processInfo.command || processInfo.name || "unknown"}`);
    }
  } else {
    console.log("没有读取到占用程序详情，但这个端口现在不能使用。");
  }
  console.log("工具不会关闭任何已有程序，只会在退出时清理自己启动的服务。");
  if (PORT_MODE === "auto" && suggestions.length > 0) {
    console.log("检测到本机端口被占用，工具已自动换到可用端口，你不用处理。");
    if (SHOW_TECHNICAL_PORT_DETAILS) {
      console.log(`技术信息：${formatServiceLabel(label)}改用端口 ${suggestions[0]}。`);
    }
    return suggestions[0];
  }

  console.log("工具暂时无法自动找到可用的本机通信通道。");
  console.log("请先完全退出本工具，再重新打开一次。");
  console.log("如果重试后仍失败，把这段终端提示发给负责人处理。");
  if (SHOW_TECHNICAL_PORT_DETAILS) {
    console.log(`技术信息：${envName} 可选端口：${suggestions.join(", ") || "附近没有找到空闲端口"}`);
    if (suggestions.length > 0) {
      console.log(`技术示例：${envName}=${suggestions[0]} pnpm dev:desktop`);
    }
  }
  process.exit(1);
}

async function ensurePortAllowed(label, port, envName) {
  if (!isProtectedPort(port)) {
    return port;
  }
  console.log(`${formatServiceLabel(label)}端口 ${port} 已被保护，工具不会使用它。`);
  return handlePortConflict(label, port, envName);
}

async function suggestFreePorts(basePort) {
  const candidates = Array.from({ length: 20 }, (_, index) => basePort + index + 1);
  const freePorts = [];
  for (const port of candidates) {
    if (!isProtectedPort(port) && (await canBindPort(port))) {
      freePorts.push(port);
    }
    if (freePorts.length >= 5) {
      break;
    }
  }
  return freePorts;
}

function canBindPort(port) {
  if (isProtectedPort(port)) {
    // Treat protected ports as unavailable even when they are technically free.
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findListeningProcesses(port) {
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    const lines = stdout.trim().split("\n").slice(1).filter(Boolean);
    const processes = [];
    for (const line of lines) {
      const columns = line.trim().split(/\s+/);
      const pid = columns[1];
      processes.push({
        name: columns[0],
        pid,
        command: await getProcessCommand(pid),
      });
    }
    return processes;
  } catch {
    return [];
  }
}

async function getProcessCommand(pid) {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="]);
    return stdout.trim();
  } catch {
    return "";
  }
}

function formatServiceLabel(label) {
  if (label === "API service") {
    return "本地 API 服务";
  }
  if (label === "Frontend dev server") {
    return "前端页面";
  }
  return label;
}

function start(command, args, name, ports = []) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    detached: process.platform !== "win32",
    env: cleanProxyEnv(),
  });
  child.__name = name;
  child.__ports = ports;
  children.push(child);
  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`${name} stopped by ${signal}.`);
    } else if (code !== 0 && code !== null) {
      console.log(`${name} exited with code ${code}.`);
    }
  });
  return child;
}

function cleanProxyEnv() {
  const env = { ...process.env };
  for (const key of [
    "all_proxy",
    "ALL_PROXY",
    "http_proxy",
    "HTTP_PROXY",
    "https_proxy",
    "HTTPS_PROXY",
    "npm_config_proxy",
    "npm_config_https_proxy",
    "CARGO_HTTP_PROXY",
    "CARGO_HTTPS_PROXY",
  ]) {
    delete env[key];
  }
  env.NO_PROXY = "*";
  env.no_proxy = "*";
  env.API_PORT = String(API_PORT);
  env.PORT = String(API_PORT);
  env.VITE_PORT = String(VITE_PORT);
  env.NEXUSAPI_DESKTOP_DEV_URL = `http://127.0.0.1:${VITE_PORT}`;
  return env;
}

async function waitForApiReady() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    if (await isApiReady()) {
      console.log(`Temporary API service is ready on 127.0.0.1:${API_PORT}.`);
      return;
    }
    await sleep(350);
  }
  throw new Error("本地 API 服务 15 秒内没有启动成功。请关闭本工具后重新打开；如果仍失败，把终端里的端口提示发给负责人。");
}

async function waitForFrontendReady() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    if (await isFrontendReady()) {
      console.log(`Frontend dev server is ready on 127.0.0.1:${VITE_PORT}.`);
      return;
    }
    await sleep(350);
  }
  throw new Error("前端页面 15 秒内没有启动成功。请关闭本工具后重新打开；如果仍失败，把终端里的端口提示发给负责人。");
}

async function isApiReady() {
  const health = await getApiHealth();
  return Boolean(health?.ok && health.service === "nexusapi-evaluator-api" && !health.proxyEnvDetected);
}

async function isFrontendReady() {
  try {
    const response = await fetchWithTimeout(`http://127.0.0.1:${VITE_PORT}/`, 1200);
    if (!response.ok) {
      return false;
    }
    const html = await response.text();
    return html.includes("NexusAPI Evaluator");
  } catch {
    return false;
  }
}

async function getApiHealth() {
  try {
    const response = await fetchWithTimeout(`http://127.0.0.1:${API_PORT}/api/health`, 1200);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadDevConfig() {
  const configUrl = new URL("../dev.config.json", import.meta.url);
  if (!existsSync(configUrl)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(configUrl, "utf8"));
  } catch (error) {
    console.log(`Failed to read dev.config.json: ${error.message}`);
    process.exit(1);
  }
}

function readPort(name, configuredValue, fallback) {
  const value = Number(process.env[name] || configuredValue || fallback);
  if (Number.isInteger(value) && value > 0 && value < 65536) {
    return value;
  }
  console.log(`${name} 必须是 1 到 65535 之间的数字。`);
  process.exit(1);
}

function readPortMode(configuredValue) {
  const value = String(process.env.PORT_MODE || configuredValue || "auto").trim().toLowerCase();
  if (value === "auto" || value === "manual") {
    return value;
  }
  console.log("PORT_MODE 只能填写 auto 或 manual。");
  process.exit(1);
}

function readBooleanFlag(name, configuredValue) {
  const value = String(process.env[name] ?? configuredValue ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function isProtectedPort(port) {
  return isProtectedPortValue(port, PROTECTED_PORTS);
}

async function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  terminateChildren("SIGTERM");
  await waitForChildrenExit(1800);
  terminateChildren("SIGKILL");
  await waitForOwnedPortsReleased(2500);
  process.exit(typeof code === "number" ? code : 0);
}

function terminateChildren(signal) {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) {
      continue;
    }
    try {
      // Only terminate child process groups started by this launcher.
      if (process.platform !== "win32") {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      try {
        child.kill(signal);
      } catch {
        // The process may have already exited.
      }
    }
  }
}

async function waitForChildrenExit(timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (children.every((child) => child.exitCode !== null || child.signalCode !== null)) {
      return;
    }
    await sleep(120);
  }
}

async function waitForOwnedPortsReleased(timeoutMs) {
  const ports = [...new Set(children.flatMap((child) => child.__ports || []))];
  if (ports.length === 0) {
    return;
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const occupied = [];
    for (const port of ports) {
      if (!(await canBindPort(port))) {
        occupied.push(port);
      }
    }
    if (occupied.length === 0) {
      console.log(`Released owned ports: ${ports.join(", ")}.`);
      return;
    }
    await sleep(150);
  }
  console.log(`Some owned ports may still be releasing: ${ports.join(", ")}.`);
}
