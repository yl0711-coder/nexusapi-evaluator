// server/db.mjs
//
// SQLite 数据层（v2.0 Step2b）。已定架构决策：用 SQLite 取代 JSONL 尾部截断，
// 为统计严谨（bootstrap/重测信度/完整历史）提供结构化、可查询、不丢老数据的存储。
//
// 驱动：Node 内置 **node:sqlite**（DatabaseSync），不是 better-sqlite3。
//   - 零新依赖、零原生编译、零 ABI/预编译匹配——免安装包打包的 Node 24 自带它
//     （release.yml 用 setup-node@24，cp $(which node) → resources/bin/node）。
//   - 防御性懒加载：若运行环境的 Node 不带 node:sqlite（如 <23.4 未带 flag），
//     本模块所有写入静默降级为 no-op，JSONL 仍是事实来源，绝不让测试或主链路崩。
//
// 过渡策略：与 JSONL 双写，JSONL 暂留作兼容镜像，验证稳定后再切只读路径。

import { SQLITE_DB_FILE } from "./paths.mjs";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS test_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT,
  run_id TEXT,
  case_id TEXT,
  profile_id TEXT,
  profile_name TEXT,
  profile_role TEXT,
  provider TEXT,
  model TEXT,
  protocol TEXT,
  started_at TEXT,
  first_byte_ms INTEGER,
  first_token_ms INTEGER,
  total_ms INTEGER,
  status_code INTEGER,
  success INTEGER,
  normalized_error TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_creation_tokens INTEGER,
  cache_read_tokens INTEGER,
  reasoning_tokens INTEGER,
  token_source TEXT,
  output_chars INTEGER,
  estimated_tokens INTEGER,
  token_audit_flag TEXT,
  raw_json TEXT,
  logged_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_requests_run ON test_requests(run_id);
CREATE INDEX IF NOT EXISTS idx_requests_profile ON test_requests(profile_id);

CREATE TABLE IF NOT EXISTS test_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  type TEXT,
  profile_id TEXT,
  profile_name TEXT,
  sample_size INTEGER,
  success_count INTEGER,
  success_rate REAL,
  ci_lower REAL,
  ci_upper REAL,
  statistical_method TEXT,
  started_at TEXT,
  ended_at TEXT,
  raw_json TEXT,
  logged_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_run ON test_runs(run_id);
`;

let DatabaseSync = null;
let moduleAvailable = null; // null=未探测, true/false=已探测
const openConnections = new Map(); // path -> DatabaseSync 实例（按路径缓存）

async function ensureModule() {
  if (moduleAvailable !== null) return moduleAvailable;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
    moduleAvailable = typeof DatabaseSync === "function";
  } catch {
    moduleAvailable = false;
  }
  return moduleAvailable;
}

export async function isSqliteAvailable() {
  return ensureModule();
}

export async function getDatabase(path = SQLITE_DB_FILE) {
  if (!(await ensureModule())) return null;
  const existing = openConnections.get(path);
  if (existing) return existing;
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  openConnections.set(path, db);
  return db;
}

export function closeDatabase(path = SQLITE_DB_FILE) {
  const db = openConnections.get(path);
  if (db) {
    try {
      db.close();
    } catch {
      // best-effort
    }
    openConnections.delete(path);
  }
}

const toInt = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
};
const toReal = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const nowIso = (record) => record?.loggedAt || record?.startedAt || null;

// 写一条逐请求记录。best-effort：任何异常都吞掉，返回 false，绝不影响主链路。
export async function recordRequest(record, { path } = {}) {
  try {
    if (!record) return false;
    const db = await getDatabase(path);
    if (!db) return false;
    const stmt = db.prepare(`
      INSERT INTO test_requests (
        request_id, run_id, case_id, profile_id, profile_name, profile_role,
        provider, model, protocol, started_at, first_byte_ms, first_token_ms,
        total_ms, status_code, success, normalized_error, input_tokens, output_tokens,
        cache_creation_tokens, cache_read_tokens, reasoning_tokens, token_source,
        output_chars, estimated_tokens, token_audit_flag, raw_json, logged_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    stmt.run(
      record.requestId ?? null,
      record.runId ?? null,
      record.caseId ?? null,
      record.profileId ?? null,
      record.profileName ?? null,
      record.profileRole ?? null,
      record.provider ?? null,
      record.model ?? null,
      record.protocol ?? null,
      record.startedAt ?? null,
      toInt(record.firstByteMs),
      toInt(record.firstTokenMs),
      toInt(record.totalMs),
      toInt(record.statusCode),
      record.success ? 1 : 0,
      record.normalizedError ?? null,
      toInt(record.inputTokens),
      toInt(record.outputTokens),
      toInt(record.cacheCreationTokens),
      toInt(record.cacheReadTokens),
      toInt(record.reasoningTokens),
      record.tokenSource ?? null,
      toInt(record.outputChars),
      toInt(record.estimatedTokens),
      record.tokenAuditFlag ?? null,
      JSON.stringify(record),
      nowIso(record),
    );
    return true;
  } catch {
    return false;
  }
}

// 写一条测试运行汇总。从稳定性/场景 summary 里提取已知字段，其余落 raw_json。
export async function recordTestRun(summary, { type = "", path } = {}) {
  try {
    if (!summary) return false;
    const db = await getDatabase(path);
    if (!db) return false;
    const ci = summary.successRateCi || {};
    const stmt = db.prepare(`
      INSERT INTO test_runs (
        run_id, type, profile_id, profile_name, sample_size, success_count,
        success_rate, ci_lower, ci_upper, statistical_method, started_at, ended_at,
        raw_json, logged_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    stmt.run(
      summary.runId ?? null,
      type || summary.type || "",
      summary.profileId ?? null,
      summary.profileName ?? null,
      toInt(summary.sampleSize ?? summary.rounds ?? summary.caseCount),
      toInt(summary.successCount),
      toReal(summary.successRate),
      toReal(ci.ci95Lower),
      toReal(ci.ci95Upper),
      ci.method || null,
      summary.startedAt ?? null,
      summary.endedAt ?? null,
      JSON.stringify(summary),
      summary.endedAt ?? summary.startedAt ?? null,
    );
    return true;
  } catch {
    return false;
  }
}

// 按 run_id 全量读取逐请求记录（统计严谨需要完整历史，不截断）。
export async function queryRequestsByRun(runId, { path } = {}) {
  const db = await getDatabase(path);
  if (!db) return [];
  return db.prepare("SELECT * FROM test_requests WHERE run_id = ? ORDER BY id ASC").all(runId);
}

export async function countRequests({ path } = {}) {
  const db = await getDatabase(path);
  if (!db) return 0;
  return db.prepare("SELECT COUNT(*) AS n FROM test_requests").get().n;
}

// 把已有 JSONL 逐请求日志回填进 SQLite（一次性迁移/补历史）。返回导入条数。
export async function importRequestsFromJsonl(lines, { path } = {}) {
  if (!(await ensureModule())) return 0;
  let imported = 0;
  for (const line of lines || []) {
    const record = typeof line === "string" ? safeParse(line) : line;
    if (record && (await recordRequest(record, { path }))) imported += 1;
  }
  return imported;
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
