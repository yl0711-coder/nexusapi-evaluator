import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProtocolRequest,
  extractOutputText,
  extractUsage,
  normalizeEmptyResponse,
  normalizeHttpError,
} from "../server/protocols.mjs";

test("builds OpenAI-compatible chat completion requests", () => {
  const request = buildProtocolRequest(
    {
      baseUrl: "https://api.example.com/",
      apiKey: "sk-test",
      protocol: "openai_compatible",
      defaultModel: "gpt-test",
      maxTokens: 256,
    },
    "hello",
  );

  assert.equal(request.url, "https://api.example.com/v1/chat/completions");
  assert.equal(request.headers.authorization, "Bearer sk-test");
  assert.equal(request.body.model, "gpt-test");
  assert.equal(request.body.messages[0].content, "hello");
  assert.equal(request.body.stream, false);
});

test("builds Claude Messages requests", () => {
  const request = buildProtocolRequest(
    {
      baseUrl: "https://api.example.com",
      apiKey: "sk-claude",
      protocol: "claude_messages",
      defaultModel: "claude-test",
      maxTokens: 512,
    },
    "hello claude",
  );

  assert.equal(request.url, "https://api.example.com/v1/messages");
  assert.equal(request.headers["x-api-key"], "sk-claude");
  assert.equal(request.headers["anthropic-version"], "2023-06-01");
  assert.equal(request.body.messages[0].content, "hello claude");
});

test("extracts output text and usage from common response formats", () => {
  assert.equal(
    extractOutputText("openai_compatible", {
      choices: [{ message: { content: "OpenAI text" } }],
    }),
    "OpenAI text",
  );
  assert.equal(
    extractOutputText("claude_messages", {
      content: [{ type: "text", text: "Claude text" }],
    }),
    "Claude text",
  );
  assert.deepEqual(extractUsage({ usage: { prompt_tokens: 12, completion_tokens: 7 } }), {
    inputTokens: 12,
    outputTokens: 7,
  });
});

test("normalizes common upstream errors", () => {
  assert.equal(normalizeHttpError(401, "bad key"), "auth_failed");
  assert.equal(normalizeHttpError(404, "model not found"), "model_not_found");
  assert.equal(normalizeHttpError(429, "too many requests"), "rate_limited");
  assert.equal(normalizeHttpError(502, "bad gateway"), "upstream_5xx");
  assert.equal(normalizeHttpError(200, "Content block not found"), "content_block_not_found");
  assert.equal(normalizeEmptyResponse("unknown model"), "model_not_found");
  assert.equal(normalizeEmptyResponse(""), "empty_response");
});
