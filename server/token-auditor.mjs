// server/token-auditor.mjs
//
// PALACE 风格 token 灌水审计（v2.0 Step5a）。两条上游欺诈防线之一（计费灌水）。
//
// 思路：从输入/输出文本用本地估算得到"应有 token 数"，对照上游 usage 报告的
//   token 数。比值显著偏高 → 疑似多计/灌水（尤其输出 token，计费更贵）；显著偏低
//   → 疑似少计/缓存命中/裁剪。
//
// 诚实边界（红线）：
//   - 本地估算是**近似**（tokenizer 家族不同 chars/token 差异大），单请求噪声大，
//     容差放宽，只抓离谱比值；聚合整轮后噪声平均，容差才收紧——聚合才是 PALACE 的
//     真信号（系统性灌水），单请求只作参考。
//   - 结论一律"疑似 / 需上游解释"，绝不写"确定灌水"（软件黑盒 + 商业诋毁法律边界）。
//   - 与 [[model-fingerprint]] 的 buildTokenAudit（usage 覆盖率/零输出）互补，不重复。

import { estimateTokens } from "./tokenizer-fingerprint.mjs";

export const TOKEN_AUDIT_VERSION = "2026.06.02";

// 单请求容差（估算噪声大）
const SINGLE_HIGH = 2.5;
const SINGLE_LOW = 0.4;
const SINGLE_EGREGIOUS = 4;
// 聚合容差（噪声平均后收紧）
const AGG_HIGH = 1.6;
const AGG_LOW = 0.6;

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ratio(reported, estimated) {
  if (reported === null || !Number.isFinite(estimated) || estimated <= 0) return null;
  return reported / estimated;
}

function round3(value) {
  return value === null ? null : Math.round(value * 1000) / 1000;
}

// 单请求审计。inputText/outputText 是实际收发文本，usage 是 extractUsage 结果。
export function auditTokenUsage({ inputText = "", outputText = "", usage = {} } = {}) {
  const estimatedInput = estimateTokens(inputText);
  const estimatedOutput = estimateTokens(outputText);
  const reportedInput = numberOrNull(usage.inputTokens);
  const reportedOutput = numberOrNull(usage.outputTokens);
  const reasoning = numberOrNull(usage.reasoningTokens);

  const inputRatio = ratio(reportedInput, estimatedInput);
  const outputRatio = ratio(reportedOutput, estimatedOutput);
  const flags = [];

  if (outputRatio !== null && outputRatio > SINGLE_HIGH) {
    flags.push({
      code: "output_inflated",
      level: outputRatio > SINGLE_EGREGIOUS ? "high" : "medium",
      note: "上游报告的输出 token 远超本地估算，疑似输出 token 灌水（输出计费更贵），需上游解释。",
    });
  }
  if (inputRatio !== null && inputRatio > SINGLE_HIGH) {
    flags.push({
      code: "input_inflated",
      level: "medium",
      note: "输入 token 远超本地估算，疑似多计/重复计费，需上游解释。",
    });
  }
  if (outputRatio !== null && outputRatio < SINGLE_LOW) {
    flags.push({
      code: "output_undercount",
      level: "low",
      note: "输出 token 远低于估算，疑似少计/缓存命中/裁剪。",
    });
  }
  if (reasoning !== null && reportedOutput && reasoning > reportedOutput * 5) {
    flags.push({
      code: "reasoning_disproportionate",
      level: "medium",
      note: "推理 token 占比异常高，需确认是否合理计费。",
    });
  }

  return {
    version: TOKEN_AUDIT_VERSION,
    method: "PALACE 风格估算对照（单请求，粗筛；需上游解释，非铁证）",
    estimatedInput,
    estimatedOutput,
    reportedInput,
    reportedOutput,
    inputRatio: round3(inputRatio),
    outputRatio: round3(outputRatio),
    flags,
    suspicious: flags.some((f) => f.level === "high" || f.level === "medium"),
    confidence: "low",
  };
}

// 整轮聚合审计（PALACE 真信号）：把多条样本的估算与报告分别求和再比，系统性灌水
// 才会在聚合比值上稳定显现。samples 每项可给 {inputText,outputText,usage} 或预估值。
export function auditRunTokenUsage(samples) {
  let estIn = 0;
  let estOut = 0;
  let repIn = 0;
  let repOut = 0;
  let n = 0;

  for (const s of samples || []) {
    const eo = s.estimatedOutputTokens ?? estimateTokens(s.outputText || "");
    const ei = s.estimatedInputTokens ?? estimateTokens(s.inputText || "");
    const ro = numberOrNull(s.reportedOutputTokens ?? s.usage?.outputTokens);
    const ri = numberOrNull(s.reportedInputTokens ?? s.usage?.inputTokens);
    if (ro === null && ri === null) continue;
    estOut += eo;
    estIn += ei;
    repOut += ro || 0;
    repIn += ri || 0;
    n += 1;
  }

  if (n === 0) {
    return { n: 0, verdict: "样本不足", suspicious: false, flags: [], confidence: "low", method: "PALACE 聚合对照" };
  }

  const outputRatio = estOut > 0 ? repOut / estOut : null;
  const inputRatio = estIn > 0 ? repIn / estIn : null;
  const flags = [];

  if (outputRatio !== null && outputRatio > AGG_HIGH) {
    flags.push({
      code: "systematic_output_inflation",
      level: outputRatio > SINGLE_EGREGIOUS ? "high" : "medium",
      note: `整轮输出 token 比估算系统性偏高（×${round3(outputRatio)}），疑似计费灌水，需上游解释。`,
    });
  }
  if (inputRatio !== null && inputRatio > AGG_HIGH) {
    flags.push({
      code: "systematic_input_inflation",
      level: "medium",
      note: `整轮输入 token 系统性偏高（×${round3(inputRatio)}），疑似多计/重复计费，需上游解释。`,
    });
  }
  if (outputRatio !== null && outputRatio < AGG_LOW) {
    flags.push({
      code: "systematic_output_undercount",
      level: "low",
      note: `整轮输出 token 系统性偏低（×${round3(outputRatio)}），疑似少计/缓存。`,
    });
  }

  const suspicious = flags.some((f) => f.level === "high" || f.level === "medium");
  return {
    n,
    estimatedInputTokens: estIn,
    estimatedOutputTokens: estOut,
    reportedInputTokens: repIn,
    reportedOutputTokens: repOut,
    inputRatio: round3(inputRatio),
    outputRatio: round3(outputRatio),
    flags,
    suspicious,
    verdict: suspicious ? "疑似计费异常，需上游解释" : "估算与报告差异在合理范围（粗筛）",
    confidence: "low",
    method: "PALACE 聚合对照（整轮，需上游解释，非铁证）",
  };
}
