import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("profiles never persist or export real API keys", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "nexusapi-profile-test-"));
  process.env.NEXUSAPI_DATA_DIR = dataDir;
  process.env.NEXUSAPI_SECRET_STORE = "memory";

  try {
    const paths = await import(`../server/paths.mjs?case=${Date.now()}`);
    const profileStore = await import(`../server/profile-store.mjs?case=${Date.now()}`);
    const secretStore = await import("../server/secret-store.mjs");
    const realKey = "sk-test-secret-123456";
    const profile = await profileStore.normalizeProfile({
      id: "profile-a",
      role: "target",
      name: "Test API",
      provider: "NexusAPI",
      baseUrl: "https://api.example.com/",
      apiKey: realKey,
      protocol: "openai_compatible",
      defaultModel: "gpt-test",
    });

    await profileStore.saveProfiles([profile]);
    const raw = await readFile(paths.PROFILES_FILE, "utf8");
    const saved = JSON.parse(raw);
    assert.equal(raw.includes(realKey), false);
    assert.equal(Object.hasOwn(saved[0], "apiKey"), false);
    assert.equal(saved[0].apiKeyRef, "profile:profile-a:api-key");
    assert.equal(saved[0].hasKey, true);

    assert.equal(await secretStore.readProfileApiKey(profile), realKey);

    const masked = profileStore.maskProfile(saved[0]);
    assert.equal(masked.apiKey, "已安全保存");

    const exported = profileStore.exportProfile(saved[0]);
    assert.equal(exported.apiKey, "");
    assert.equal(Object.hasOwn(exported, "apiKeyRef"), false);
    assert.equal(Object.hasOwn(exported, "keyStorage"), false);
  } finally {
    delete process.env.NEXUSAPI_DATA_DIR;
    delete process.env.NEXUSAPI_SECRET_STORE;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("imported profiles do not trust external api key references", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "nexusapi-profile-import-test-"));
  process.env.NEXUSAPI_DATA_DIR = dataDir;
  process.env.NEXUSAPI_SECRET_STORE = "memory";

  try {
    const profileStore = await import(`../server/profile-store.mjs?case=import-${Date.now()}`);
    const imported = await profileStore.normalizeImportedProfiles({
      profiles: [
        {
          id: "external-profile",
          role: "target",
          name: "External API",
          provider: "Vendor",
          baseUrl: "https://api.example.com",
          apiKeyRef: "profile:external-profile:api-key",
          keyStorage: "macos-keychain",
          hasKey: true,
          protocol: "openai_compatible",
          defaultModel: "model-a",
        },
      ],
    });

    assert.equal(imported[0].apiKeyRef, "");
    assert.equal(imported[0].keyStorage, "");
    assert.equal(imported[0].hasKey, false);

    const existing = {
      id: "external-profile",
      apiKeyRef: "profile:external-profile:api-key",
      keyStorage: "test-memory-vault",
      hasKey: true,
    };
    const importedExisting = await profileStore.normalizeImportedProfiles(
      {
        profiles: [
          {
            id: "external-profile",
            role: "target",
            name: "External API",
            provider: "Vendor",
            baseUrl: "https://api.example.com",
            apiKeyRef: "attacker-ref",
            keyStorage: "macos-keychain",
            hasKey: true,
            protocol: "openai_compatible",
            defaultModel: "model-a",
          },
        ],
      },
      [existing],
    );

    assert.equal(importedExisting[0].apiKeyRef, existing.apiKeyRef);
    assert.equal(importedExisting[0].keyStorage, existing.keyStorage);
    assert.equal(importedExisting[0].hasKey, true);
  } finally {
    delete process.env.NEXUSAPI_DATA_DIR;
    delete process.env.NEXUSAPI_SECRET_STORE;
    await rm(dataDir, { recursive: true, force: true });
  }
});
