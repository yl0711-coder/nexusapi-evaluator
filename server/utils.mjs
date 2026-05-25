import { appendFile } from "node:fs/promises";

export function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseLooseJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const direct = safeJson(raw);
  if (direct) return direct;
  const match = raw.match(/\{[\s\S]*\}/);
  return match ? safeJson(match[0]) : null;
}

export function summarizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export async function appendJsonLine(file, value) {
  await appendFile(file, `${JSON.stringify(value)}\n`, "utf8");
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

export function compactDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

export function mean(values) {
  const clean = values.filter(isFiniteNumber).map(Number);
  if (clean.length === 0) return null;
  return Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

export function percentile(values, ratio) {
  const clean = values.filter(isFiniteNumber).map(Number).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const index = Math.ceil(clean.length * ratio) - 1;
  return clean[Math.max(0, Math.min(clean.length - 1, index))];
}

export function sumNullable(values) {
  const clean = values.filter(isFiniteNumber).map(Number);
  if (clean.length === 0) return null;
  return clean.reduce((sum, value) => sum + value, 0);
}

export function groupBy(values, getKey) {
  const groups = {};
  for (const value of values) {
    const key = getKey(value);
    groups[key] = groups[key] || [];
    groups[key].push(value);
  }
  return groups;
}

export function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

export function requiredString(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${label} 不能为空。`);
  }
  return text;
}

export function escapeHtmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeMarkdownTable(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

export function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

export function hasProxyEnv() {
  return [
    "all_proxy",
    "ALL_PROXY",
    "http_proxy",
    "HTTP_PROXY",
    "https_proxy",
    "HTTPS_PROXY",
  ].some((key) => Boolean(process.env[key]));
}
