import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getModelCapability } from "../modelCapabilities";

async function writeCapabilityCache(
  configHome: string,
  models: Array<{ id: string; max_input_tokens?: number; max_tokens?: number }>
) {
  const cacheDir = join(configHome, "cache");
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    join(cacheDir, "model-capabilities.json"),
    JSON.stringify({ models, timestamp: Date.now() }),
    "utf-8"
  );
}

describe("getModelCapability", () => {
  const originalUserType = process.env.USER_TYPE;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const providerEnvKeys = [
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_OPENAI",
    "CLAUDE_CODE_USE_GEMINI",
    "CLAUDE_CODE_USE_GROK",
  ] as const;
  const savedProviderEnv: Record<string, string | undefined> = {};
  let configHome = "";

  beforeEach(async () => {
    configHome = await mkdtemp(join(tmpdir(), "claude-model-cap-"));
    process.env.USER_TYPE = "ant";
    process.env.CLAUDE_CONFIG_DIR = configHome;
    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    for (const key of providerEnvKeys) {
      savedProviderEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    if (originalUserType !== undefined) {
      process.env.USER_TYPE = originalUserType;
    } else {
      delete process.env.USER_TYPE;
    }

    if (originalConfigDir !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.CLAUDE_CONFIG_DIR;
    }

    if (originalBaseUrl !== undefined) {
      process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.ANTHROPIC_BASE_URL;
    }

    for (const key of providerEnvKeys) {
      if (savedProviderEnv[key] !== undefined) {
        process.env[key] = savedProviderEnv[key];
      } else {
        delete process.env[key];
      }
    }

    if (configHome) {
      await rm(configHome, { recursive: true, force: true });
    }
  });

  test("returns undefined when provider is not first-party", async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = "1";
    await writeCapabilityCache(configHome, [
      { id: "claude-sonnet-4-6", max_input_tokens: 1_000_000 },
    ]);

    expect(getModelCapability("claude-sonnet-4-6-20250514")).toBeUndefined();
  });

  test("uses cached capability with custom ANTHROPIC_BASE_URL", async () => {
    process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:8317";
    process.env.USER_TYPE = "external";
    await writeCapabilityCache(configHome, [
      { id: "gpt-5.4", max_input_tokens: 400_000 },
    ]);

    expect(getModelCapability("gpt-5.4")).toEqual({
      id: "gpt-5.4",
      max_input_tokens: 400_000,
    });
  });

  test("matches exact cached model IDs", async () => {
    await writeCapabilityCache(configHome, [
      { id: "claude-sonnet-4-6-20250514", max_input_tokens: 500_000 },
    ]);

    expect(getModelCapability("claude-sonnet-4-6-20250514")).toEqual({
      id: "claude-sonnet-4-6-20250514",
      max_input_tokens: 500_000,
    });
  });

  test("matches provider model strings by substring", async () => {
    await writeCapabilityCache(configHome, [
      { id: "claude-sonnet-4-6", max_input_tokens: 1_000_000 },
    ]);

    expect(
      getModelCapability("us.anthropic.claude-sonnet-4-6-v1:0")
    ).toEqual({
      id: "claude-sonnet-4-6",
      max_input_tokens: 1_000_000,
    });
  });
});
