import { afterEach, describe, expect, test } from "bun:test";
import {
  resetStateForTests,
  setMainLoopModelOverride,
} from "src/bootstrap/state";
import { getAgentModel } from "../agent";

describe("getAgentModel", () => {
  afterEach(() => {
    resetStateForTests();
  });

  test("uses parent model when tool override is inherit", () => {
    expect(
      getAgentModel(
        "sonnet",
        "claude-sonnet-4-6-20250514",
        "inherit",
        "default"
      )
    ).toBe("claude-sonnet-4-6-20250514");
  });

  test("keeps parent exact model for inherit in plan mode even when global override is opusplan", () => {
    setMainLoopModelOverride("opusplan");

    expect(
      getAgentModel(
        "sonnet",
        "claude-sonnet-4-6-20250514",
        "inherit",
        "plan"
      )
    ).toBe("claude-sonnet-4-6-20250514");
  });

  test("uses parent exact model when tool override matches parent tier alias", () => {
    expect(
      getAgentModel(
        "haiku",
        "claude-opus-4-6-20250514",
        "opus",
        "default"
      )
    ).toBe("claude-opus-4-6-20250514");
  });

  test("passes through explicit tool model string unchanged", () => {
    expect(
      getAgentModel(
        "sonnet",
        "claude-sonnet-4-6-20250514",
        "claude-opus-4-6-20250514",
        "default"
      )
    ).toBe("claude-opus-4-6-20250514");
  });

  test("falls back to agent frontmatter model when no tool override is provided", () => {
    expect(
      getAgentModel(
        "claude-opus-4-6-20250514",
        "claude-sonnet-4-6-20250514",
        undefined,
        "default"
      )
    ).toBe("claude-opus-4-6-20250514");
  });

  test("ignores blank tool override and falls back to agent model", () => {
    expect(
      getAgentModel(
        "claude-opus-4-6-20250514",
        "claude-sonnet-4-6-20250514",
        "   ",
        "default"
      )
    ).toBe("claude-opus-4-6-20250514");
  });
});
