import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PROFILES_FILE } from "./paths.mjs";
import { normalizePricePerMillion } from "./costing.mjs";
import { buildApiKeyRef, getSecretStorageName, saveProfileApiKey } from "./secret-store.mjs";
import { requiredString } from "./utils.mjs";

// Profile records are safe to persist. API keys are migrated into secret-store
// and stripped before profiles.json is written.
export async function normalizeProfile(body, existingProfile = null) {
  const id = String(body.id || existingProfile?.id || crypto.randomUUID());
  const apiKey = String(body.apiKey || "").trim();
  const hasExistingKey = Boolean(existingProfile?.apiKeyRef);
  if (!apiKey && !hasExistingKey) {
    throw new Error("API Key 不能为空。");
  }
  const keyInfo = apiKey ? await saveProfileApiKey(id, apiKey) : null;
  return {
    id,
    role: normalizeProfileRole(body.role),
    name: requiredString(body.name, "名称"),
    provider: requiredString(body.provider, "供应商"),
    baseUrl: requiredString(body.baseUrl, "Base URL").replace(/\/+$/, ""),
    apiKeyRef: keyInfo?.ref || existingProfile?.apiKeyRef || buildApiKeyRef(id),
    keyStorage: keyInfo?.storage || existingProfile?.keyStorage || getSecretStorageName(),
    hasKey: Boolean(keyInfo || existingProfile?.apiKeyRef),
    protocol: normalizeProtocol(body.protocol),
    defaultModel: requiredString(body.defaultModel, "默认模型"),
    channelCode: String(body.channelCode || "").trim(),
    throughNexusAPI: Boolean(body.throughNexusAPI),
    maxTokens: Number(body.maxTokens || 512),
    timeoutMs: Number(body.timeoutMs || 60000),
    inputPricePerMTokens: normalizePricePerMillion(body.inputPricePerMTokens),
    outputPricePerMTokens: normalizePricePerMillion(body.outputPricePerMTokens),
    inputSellPricePerMTokens: normalizePricePerMillion(body.inputSellPricePerMTokens),
    outputSellPricePerMTokens: normalizePricePerMillion(body.outputSellPricePerMTokens),
    notes: String(body.notes || "").trim(),
    createdAt: existingProfile?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeProtocol(protocol) {
  if (protocol === "claude_messages") return "claude_messages";
  if (protocol === "openai_chat") return "openai_chat";
  return "openai_compatible";
}

export function maskProfile(profile) {
  return {
    ...stripProfileSecret(profile),
    apiKey: profile.hasKey || profile.apiKeyRef ? "已安全保存" : "",
    hasKey: Boolean(profile.hasKey || profile.apiKeyRef),
  };
}

export function exportProfile(profile) {
  const { apiKeyRef, keyStorage, ...safeProfile } = maskProfile(profile);
  return {
    ...safeProfile,
    apiKey: "",
    exportNote: "API Key 已移除。导入后需要重新填写 Key。",
  };
}

export async function normalizeImportedProfiles(body, currentProfiles = []) {
  const items = Array.isArray(body.profiles) ? body.profiles : [];
  const profiles = [];
  for (const item of items) {
    const existing = currentProfiles.find((profile) => profile.id === item.id);
    const id = String(item.id || crypto.randomUUID());
    const apiKey = String(item.apiKey || "").trim();
    const keyInfo = apiKey ? await saveProfileApiKey(id, apiKey) : null;
    profiles.push({
      id,
      role: normalizeProfileRole(item.role),
      name: requiredString(item.name, "名称"),
      provider: requiredString(item.provider, "供应商"),
      baseUrl: requiredString(item.baseUrl, "Base URL").replace(/\/+$/, ""),
      apiKeyRef: keyInfo?.ref || existing?.apiKeyRef || "",
      keyStorage: keyInfo?.storage || existing?.keyStorage || "",
      hasKey: Boolean(keyInfo || existing?.apiKeyRef),
      protocol: normalizeProtocol(item.protocol),
      defaultModel: requiredString(item.defaultModel, "默认模型"),
      channelCode: String(item.channelCode || "").trim(),
      throughNexusAPI: Boolean(item.throughNexusAPI),
      maxTokens: Number(item.maxTokens || 512),
      timeoutMs: Number(item.timeoutMs || 60000),
      inputPricePerMTokens: normalizePricePerMillion(item.inputPricePerMTokens),
      outputPricePerMTokens: normalizePricePerMillion(item.outputPricePerMTokens),
      inputSellPricePerMTokens: normalizePricePerMillion(item.inputSellPricePerMTokens),
      outputSellPricePerMTokens: normalizePricePerMillion(item.outputSellPricePerMTokens),
      notes: String(item.notes || "").trim(),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  return profiles;
}

export function mergeProfiles(currentProfiles, importedProfiles) {
  const merged = [...currentProfiles];
  for (const imported of importedProfiles) {
    const index = merged.findIndex((profile) => profile.id === imported.id);
    if (index >= 0) {
      merged[index] = {
        ...merged[index],
        ...imported,
        apiKeyRef: imported.apiKeyRef || merged[index].apiKeyRef || "",
        keyStorage: imported.keyStorage || merged[index].keyStorage || "",
        hasKey: Boolean(imported.apiKeyRef || merged[index].apiKeyRef),
      };
    } else {
      merged.push(imported);
    }
  }
  return merged;
}

export function maskScenario(scenario) {
  return {
    id: scenario.id,
    name: scenario.name,
    category: scenario.category,
    difficulty: scenario.difficulty,
    minChars: scenario.minChars,
    expectsJson: Boolean(scenario.expectsJson),
    expectsSafetyRefusal: Boolean(scenario.expectsSafetyRefusal),
  };
}

export function maskKey(value) {
  const text = String(value || "");
  if (text.length <= 8) return "****";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export async function loadProfiles() {
  if (!existsSync(PROFILES_FILE)) {
    return [];
  }
  const raw = await readFile(PROFILES_FILE, "utf8");
  const profiles = JSON.parse(raw || "[]");
  return migrateProfileSecrets(profiles);
}

export async function saveProfiles(profiles) {
  const sanitized = profiles.map(stripProfileSecret);
  await mkdir(dirname(PROFILES_FILE), { recursive: true });
  await writeFile(PROFILES_FILE, JSON.stringify(sanitized, null, 2), "utf8");
}

async function migrateProfileSecrets(profiles) {
  let changed = false;
  const migrated = [];
  for (const profile of profiles) {
    const next = { ...profile };
    if (next.apiKey) {
      const keyInfo = await saveProfileApiKey(next.id, next.apiKey);
      next.apiKeyRef = keyInfo.ref;
      next.keyStorage = keyInfo.storage;
      next.hasKey = true;
      delete next.apiKey;
      changed = true;
    } else if (next.apiKeyRef && !next.hasKey) {
      next.hasKey = true;
      changed = true;
    }
    migrated.push(stripProfileSecret(next));
  }
  if (changed) {
    await saveProfiles(migrated);
  }
  return migrated;
}

function normalizeProfileRole(role) {
  if (role === "judge") return "judge";
  if (role === "baseline") return "baseline";
  return "target";
}

function stripProfileSecret(profile) {
  const { apiKey, ...rest } = profile;
  return rest;
}
