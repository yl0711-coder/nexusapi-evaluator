import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  closeDatabase,
  countRequests,
  getDatabase,
  importRequestsFromJsonl,
  isSqliteAvailable,
  queryRequestsByRun,
  recordRequest,
  recordTestRun,
} from "../server/db.mjs";

const makeRecord = (overrides = {}) => ({
  requestId: "req-1",
  runId: "run-1",
  caseId: "",
  profileId: "p1",
  profileName: "甲",
  profileRole: "target",
  provider: "mock",
  model: "mock-model",
  protocol: "openai_compatible",
  startedAt: "2026-06-02T00:00:00Z",
  firstByteMs: 120,
  firstTokenMs: 120,
  totalMs: 1500,
  statusCode: 200,
  success: true,
  normalizedError: null,
  inputTokens: 50,
  outputTokens: 30,
  cacheCreationTokens: null,
  cacheReadTokens: 10,
  reasoningTokens: null,
  tokenSource: "upstream",
  outputChars: 200,
  loggedAt: "2026-06-02T00:00:01Z",
  ...overrides,
});

test("node:sqlite is available on this runtime", async () => {
  // CI/打包用 Node 24 自带 node:sqlite；若这里为 false 说明运行环境过旧，
  // 数据层会降级为 JSONL-only（仍可用，但统计完整历史受限）。
  assert.equal(await isSqliteAvailable(), true);
});

test("recordRequest persists a row and queryRequestsByRun reads it back in full", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexusapi-db-"));
  const path = join(dir, "test.db");
  try {
    assert.equal(await recordRequest(makeRecord({ requestId: "a" }), { path }), true);
    assert.equal(await recordRequest(makeRecord({ requestId: "b", success: false, normalizedError: "timeout" }), { path }), true);
    assert.equal(await recordRequest(makeRecord({ requestId: "c", runId: "run-2" }), { path }), true);

    const run1 = await queryRequestsByRun("run-1", { path });
    assert.equal(run1.length, 2);
    assert.equal(run1[0].request_id, "a");
    assert.equal(run1[0].success, 1);
    assert.equal(run1[1].success, 0);
    assert.equal(run1[1].normalized_error, "timeout");
    assert.equal(run1[0].cache_read_tokens, 10);

    assert.equal(await countRequests({ path }), 3);
  } finally {
    closeDatabase(path);
    await rm(dir, { recursive: true, force: true });
  }
});

test("full history is retained beyond the old JSONL tail window (no truncation)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexusapi-db-"));
  const path = join(dir, "history.db");
  try {
    for (let i = 0; i < 500; i++) {
      await recordRequest(makeRecord({ requestId: `r${i}`, runId: "big" }), { path });
    }
    assert.equal(await countRequests({ path }), 500);
    assert.equal((await queryRequestsByRun("big", { path })).length, 500);
  } finally {
    closeDatabase(path);
    await rm(dir, { recursive: true, force: true });
  }
});

test("recordTestRun stores summary with CI columns", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexusapi-db-"));
  const path = join(dir, "runs.db");
  try {
    const ok = await recordTestRun(
      {
        runId: "run-1",
        profileId: "p1",
        profileName: "甲",
        rounds: 10,
        successCount: 8,
        successRate: 0.8,
        successRateCi: { ci95Lower: 0.49, ci95Upper: 0.94, method: "wilson" },
        startedAt: "2026-06-02T00:00:00Z",
        endedAt: "2026-06-02T00:01:00Z",
      },
      { type: "stability", path },
    );
    assert.equal(ok, true);
    const db = await getDatabase(path);
    const row = db.prepare("SELECT * FROM test_runs WHERE run_id = ?").get("run-1");
    assert.equal(row.type, "stability");
    assert.equal(row.sample_size, 10);
    assert.equal(row.success_count, 8);
    assert.equal(row.ci_lower, 0.49);
    assert.equal(row.statistical_method, "wilson");
  } finally {
    closeDatabase(path);
    await rm(dir, { recursive: true, force: true });
  }
});

test("importRequestsFromJsonl backfills history from JSONL lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexusapi-db-"));
  const path = join(dir, "import.db");
  try {
    const lines = [
      JSON.stringify(makeRecord({ requestId: "x1", runId: "imp" })),
      JSON.stringify(makeRecord({ requestId: "x2", runId: "imp" })),
      "not-json-should-skip",
    ];
    const imported = await importRequestsFromJsonl(lines, { path });
    assert.equal(imported, 2);
    assert.equal(await countRequests({ path }), 2);
  } finally {
    closeDatabase(path);
    await rm(dir, { recursive: true, force: true });
  }
});

test("recordRequest never throws on malformed input (best-effort)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexusapi-db-"));
  const path = join(dir, "robust.db");
  try {
    assert.equal(await recordRequest(null, { path }), false);
    assert.equal(await recordRequest(undefined, { path }), false);
    assert.equal(await recordRequest({ requestId: "only-id" }, { path }), true);
  } finally {
    closeDatabase(path);
    await rm(dir, { recursive: true, force: true });
  }
});
