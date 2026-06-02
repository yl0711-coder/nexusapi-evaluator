export function buildProtocolRequest(profile, prompt) {
  const model = profile.defaultModel;
  const text = prompt.trim() || "请用一句话说明你现在可以正常工作。";
  const baseUrl = profile.baseUrl.replace(/\/+$/, "");

  if (profile.protocol === "claude_messages") {
    return {
      url: `${baseUrl}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": profile.apiKey,
        "anthropic-version": profile.anthropicVersion || "2023-06-01",
      },
      body: {
        model,
        max_tokens: Number(profile.maxTokens || 512),
        messages: [{ role: "user", content: text }],
      },
    };
  }

  return {
    url: `${baseUrl}/v1/chat/completions`,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${profile.apiKey}`,
    },
    body: {
      model,
      messages: [{ role: "user", content: text }],
      temperature: 0.2,
      max_tokens: Number(profile.maxTokens || 512),
      stream: false,
    },
  };
}

export function buildProtocolToolRequest(profile) {
  const model = profile.defaultModel;
  const baseUrl = profile.baseUrl.replace(/\/+$/, "");
  const toolName = "get_weather";
  const prompt = "请调用 get_weather 查询北京天气，只返回工具调用，不要输出自然语言解释。";

  if (profile.protocol === "claude_messages") {
    return {
      url: `${baseUrl}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": profile.apiKey,
        "anthropic-version": profile.anthropicVersion || "2023-06-01",
      },
      body: {
        model,
        max_tokens: Number(profile.maxTokens || 512),
        tools: [
          {
            name: toolName,
            description: "Get weather for a city",
            input_schema: {
              type: "object",
              properties: {
                city: {
                  type: "string",
                  description: "City name",
                },
              },
              required: ["city"],
            },
          },
        ],
        tool_choice: {
          type: "tool",
          name: toolName,
        },
        messages: [{ role: "user", content: prompt }],
      },
    };
  }

  return {
    url: `${baseUrl}/v1/chat/completions`,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${profile.apiKey}`,
    },
    body: {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: Number(profile.maxTokens || 512),
      stream: false,
      tools: [
        {
          type: "function",
          function: {
            name: toolName,
            description: "Get weather for a city",
            parameters: {
              type: "object",
              properties: {
                city: {
                  type: "string",
                  description: "City name",
                },
              },
              required: ["city"],
            },
          },
        },
      ],
      tool_choice: {
        type: "function",
        function: {
          name: toolName,
        },
      },
    },
  };
}

export function buildProtocolStreamRequest(profile, prompt) {
  const model = profile.defaultModel;
  const text = prompt.trim() || "请用一句话说明你现在可以正常工作。";
  const baseUrl = profile.baseUrl.replace(/\/+$/, "");

  if (profile.protocol === "claude_messages") {
    return {
      url: `${baseUrl}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": profile.apiKey,
        "anthropic-version": profile.anthropicVersion || "2023-06-01",
      },
      body: {
        model,
        max_tokens: Number(profile.maxTokens || 512),
        stream: true,
        messages: [{ role: "user", content: text }],
      },
    };
  }

  return {
    url: `${baseUrl}/v1/chat/completions`,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${profile.apiKey}`,
    },
    body: {
      model,
      messages: [{ role: "user", content: text }],
      temperature: 0.2,
      max_tokens: Number(profile.maxTokens || 512),
      stream: true,
    },
  };
}

export function parseSseEvents(raw) {
  const events = [];
  let eventName = "";
  const dataLines = [];

  const flush = () => {
    if (!eventName && dataLines.length === 0) return;
    const data = dataLines.join("\n");
    events.push({
      event: eventName,
      data,
      parsed: data && data !== "[DONE]" ? safeJsonForProtocol(data) : null,
    });
    eventName = "";
    dataLines.length = 0;
  };

  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  flush();
  return events;
}

export function summarizeStreamStructure(protocol, raw) {
  const events = parseSseEvents(raw);
  if (protocol === "claude_messages") {
    return summarizeClaudeStream(events, raw);
  }
  return summarizeOpenAiStream(events, raw);
}

export function extractOutputText(protocol, parsed) {
  if (!parsed || typeof parsed !== "object") {
    return "";
  }

  if (protocol === "claude_messages") {
    const content = Array.isArray(parsed.content) ? parsed.content : [];
    return content
      .map((item) => (item && item.type === "text" ? item.text || "" : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return String(parsed.choices?.[0]?.message?.content || "").trim();
}

export function extractToolCall(protocol, parsed) {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  if (protocol === "claude_messages") {
    const content = Array.isArray(parsed.content) ? parsed.content : [];
    const toolUse = content.find((item) => item && item.type === "tool_use");
    return toolUse
      ? {
          name: toolUse.name || "",
          arguments: toolUse.input || {},
        }
      : null;
  }

  const toolCall = parsed.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) {
    return null;
  }
  return {
    name: toolCall.function?.name || toolCall.name || "",
    arguments: toolCall.function?.arguments || toolCall.arguments || {},
  };
}

export function extractUsage(parsed) {
  if (!parsed || typeof parsed !== "object" || !parsed.usage) {
    return null;
  }

  const usage = parsed.usage;
  // 2026 年成本大头：缓存读写 + 推理 token。各家字段名不同，统一归一。
  // OpenAI：prompt_tokens_details.cached_tokens / completion_tokens_details.reasoning_tokens
  // Anthropic：cache_creation_input_tokens / cache_read_input_tokens（thinking 已计入 output_tokens）
  const promptDetails = usage.prompt_tokens_details || usage.input_tokens_details || {};
  const completionDetails = usage.completion_tokens_details || usage.output_tokens_details || {};

  return {
    inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? null,
    outputTokens: usage.completion_tokens ?? usage.output_tokens ?? null,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? usage.cache_creation_tokens ?? null,
    cacheReadTokens:
      usage.cache_read_input_tokens ?? usage.cache_read_tokens ?? promptDetails.cached_tokens ?? null,
    reasoningTokens: usage.reasoning_tokens ?? completionDetails.reasoning_tokens ?? null,
  };
}

export function normalizeHttpError(status, raw) {
  const text = String(raw || "").toLowerCase();
  if (status === 401 || status === 403) return "auth_failed";
  if (text.includes("content block not found")) return "content_block_not_found";
  if (status === 404 || /model.*not.*found|unknown model|invalid model/.test(text)) return "model_not_found";
  if (status === 429) return "rate_limited";
  if (/rate limit|too many requests|quota exceeded|insufficient quota/.test(text)) return "rate_limited";
  if (status >= 500) return "upstream_5xx";
  return "invalid_response";
}

export function normalizeEmptyResponse(raw) {
  const text = String(raw || "").toLowerCase();
  if (text.includes("content block not found")) return "content_block_not_found";
  if (/model.*not.*found|unknown model|invalid model/.test(text)) return "model_not_found";
  if (/rate limit|too many requests|quota exceeded|insufficient quota/.test(text)) return "rate_limited";
  return "empty_response";
}

function summarizeClaudeStream(events, raw) {
  const issues = [];
  let sawMessageStart = false;
  let sawContentStart = false;
  let sawDelta = false;
  let sawContentStop = false;
  let sawMessageStop = false;
  let invalidOrder = false;

  for (const item of events) {
    const type = item.event || item.parsed?.type || "";
    if (type === "message_start") {
      sawMessageStart = true;
    } else if (type === "content_block_start") {
      if (!sawMessageStart) invalidOrder = true;
      sawContentStart = true;
    } else if (type === "content_block_delta") {
      if (!sawContentStart) invalidOrder = true;
      sawDelta = true;
    } else if (type === "content_block_stop") {
      if (!sawContentStart) invalidOrder = true;
      sawContentStop = true;
    } else if (type === "message_stop") {
      sawMessageStop = true;
    } else if (type === "error") {
      issues.push("stream_error_event");
    }
  }

  if (!events.length) issues.push("empty_stream");
  if (!sawMessageStart) issues.push("missing_message_start");
  if (!sawContentStart) issues.push("missing_content_block_start");
  if (!sawDelta) issues.push("missing_content_block_delta");
  if (!sawContentStop) issues.push("missing_content_block_stop");
  if (!sawMessageStop) issues.push("missing_message_stop");
  if (invalidOrder) issues.push("event_order_invalid");
  if (/content block not found/i.test(String(raw || ""))) issues.push("content_block_not_found");

  return {
    protocol: "claude_messages",
    passed: issues.length === 0,
    eventCount: events.length,
    issues,
    flags: {
      messageStart: sawMessageStart,
      contentBlockStart: sawContentStart,
      contentBlockDelta: sawDelta,
      contentBlockStop: sawContentStop,
      messageStop: sawMessageStop,
    },
  };
}

function summarizeOpenAiStream(events, raw) {
  const issues = [];
  let sawDelta = false;
  let sawDone = false;
  let invalidJsonChunks = 0;

  for (const item of events) {
    if (item.data === "[DONE]") {
      sawDone = true;
      continue;
    }
    if (!item.parsed) {
      invalidJsonChunks += 1;
      continue;
    }
    const choices = Array.isArray(item.parsed.choices) ? item.parsed.choices : [];
    const delta = choices[0]?.delta;
    if (delta && typeof delta === "object" && Object.keys(delta).length > 0) {
      sawDelta = true;
    }
  }

  if (!events.length) issues.push("empty_stream");
  if (!sawDelta) issues.push("missing_delta");
  if (!sawDone) issues.push("missing_done");
  if (invalidJsonChunks > 0) issues.push("invalid_json_chunk");
  if (/content block not found/i.test(String(raw || ""))) issues.push("content_block_not_found");

  return {
    protocol: "openai_compatible",
    passed: issues.length === 0,
    eventCount: events.length,
    issues,
    flags: {
      delta: sawDelta,
      done: sawDone,
      invalidJsonChunks,
    },
  };
}

function safeJsonForProtocol(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
