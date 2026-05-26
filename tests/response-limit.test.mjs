import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedResponseText, stripHeavyRunResult } from "../server/test-runner.mjs";

test("bounded response reader stops reading oversized upstream responses", async () => {
  const controller = new AbortController();
  const response = new Response("x".repeat(128), {
    headers: { "content-length": "128" },
  });

  const result = await readBoundedResponseText(response, 16, controller);

  assert.equal(result.truncated, true);
  assert.equal(controller.signal.aborted, true);
});

test("bounded response reader returns normal small upstream responses", async () => {
  const controller = new AbortController();
  const response = new Response(JSON.stringify({ ok: true }));

  const result = await readBoundedResponseText(response, 1024, controller);

  assert.equal(result.truncated, false);
  assert.match(result.text, /"ok":true/);
});

test("bounded response reader rejects unknown-size non-stream responses", async () => {
  const controller = new AbortController();
  const response = {
    headers: new Headers(),
    body: null,
    text: async () => "x".repeat(128),
  };

  const result = await readBoundedResponseText(response, 16, controller);

  assert.equal(result.truncated, true);
  assert.equal(controller.signal.aborted, true);
});

test("batch result compaction removes nested heavy report content", () => {
  const result = stripHeavyRunResult({
    runId: "run-demo",
    profileName: "Demo",
    successRateText: "100%",
    reportPath: "/tmp/report.md",
    reportMarkdown: "# long markdown\n".repeat(100),
    records: [{ requestId: "a" }, { requestId: "b" }],
  });

  assert.equal(result.runId, "run-demo");
  assert.equal(result.reportMarkdown, undefined);
  assert.equal(result.recordCount, 2);
});
