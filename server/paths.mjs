import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ROOT = fileURLToPath(new URL("../", import.meta.url));

export const ROOT = process.env.NEXUSAPI_APP_ROOT || SOURCE_ROOT;
export const STATIC_ROOT = process.env.NEXUSAPI_STATIC_DIR || ROOT;
export const LEGACY_DATA_DIR = process.env.NEXUSAPI_LEGACY_DATA_DIR || join(ROOT, "app-data");
export const DATA_DIR = process.env.NEXUSAPI_DATA_DIR || join(ROOT, "NexusAPI数据");
export const CONFIG_DIR = join(DATA_DIR, "配置");
export const REPORTS_DIR = join(DATA_DIR, "报告");
export const LOGS_DIR = join(DATA_DIR, "日志");
export const VAULT_DIR = join(DATA_DIR, ".vault");
export const RUNTIME_DIR = join(DATA_DIR, ".runtime");
export const PROFILES_FILE = join(CONFIG_DIR, "profiles.json");
export const REQUEST_LOG_FILE = join(LOGS_DIR, "requests.jsonl");
export const TEST_RUNS_FILE = join(LOGS_DIR, "test-runs.jsonl");
export const TASK_EVENTS_FILE = join(LOGS_DIR, "task-events.jsonl");
export const ERROR_LOG_FILE = join(LOGS_DIR, "errors.jsonl");
export const LOCAL_SECRET_FILE = join(VAULT_DIR, "local-secret.key");
export const LOCAL_VAULT_FILE = join(VAULT_DIR, "key-vault.json");
