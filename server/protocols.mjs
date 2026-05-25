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

export function extractUsage(parsed) {
  if (!parsed || typeof parsed !== "object" || !parsed.usage) {
    return null;
  }

  return {
    inputTokens: parsed.usage.prompt_tokens ?? parsed.usage.input_tokens ?? null,
    outputTokens: parsed.usage.completion_tokens ?? parsed.usage.output_tokens ?? null,
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
