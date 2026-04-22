import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  MODEL_CONTEXT_WINDOW_DEFAULT,
  getContextWindowForModel,
  getModelMaxOutputTokens,
} from "../context";

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

describe("context capability integration", () => {
  const originalUserType = process.env.USER_TYPE;
  const originalDisable1m = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT;
  const originalMaxContext = process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
  let configHome = "";

  beforeEach(async () => {
    configHome = await mkdtemp(join(tmpdir(), "claude-context-cap-"));
    process.env.USER_TYPE = "ant";
    process.env.CLAUDE_CONFIG_DIR = configHome;
    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT;
    delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
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

    if (originalDisable1m !== undefined) {
      process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = originalDisable1m;
    } else {
      delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT;
    }

    if (originalMaxContext !== undefined) {
      process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = originalMaxContext;
    } else {
      delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
    }

    if (configHome) {
      await rm(configHome, { recursive: true, force: true });
    }
  });

  test("uses capability max_input_tokens when available", async () => {
    await writeCapabilityCache(configHome, [
      { id: "claude-opus-4-6", max_input_tokens: 500_000 },
    ]);

    expect(getContextWindowForModel("claude-opus-4-6-20250514")).toBe(500_000);
  });

  test("uses cached capability for custom base URL runtime model", async () => {
    process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:8317";
    process.env.USER_TYPE = "external";
    await writeCapabilityCache(configHome, [
      { id: "gpt-5.4", max_input_tokens: 400_000 },
    ]);

    expect(getContextWindowForModel("gpt-5.4")).toBe(400_000);
  });

  test("caps capability-based 1M context to default when 1M is disabled", async () => {
    await writeCapabilityCache(configHome, [
      { id: "claude-opus-4-6", max_input_tokens: 1_000_000 },
    ]);
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = "1";

    expect(getContextWindowForModel("claude-opus-4-6-20250514")).toBe(
      MODEL_CONTEXT_WINDOW_DEFAULT
    );
  });

  test("lets ant max-context env override capability-derived context", async () => {
    await writeCapabilityCache(configHome, [
      { id: "claude-opus-4-6", max_input_tokens: 500_000 },
    ]);
    process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = "300000";

    expect(getContextWindowForModel("claude-opus-4-6-20250514")).toBe(300_000);
  });

  test("uses capability max_tokens as output upper limit", async () => {
    await writeCapabilityCache(configHome, [
      { id: "claude-opus-4-6", max_tokens: 8_192 },
    ]);

    expect(getModelMaxOutputTokens("claude-opus-4-6-20250514")).toEqual({
      default: 8_192,
      upperLimit: 8_192,
    });
  });
});
