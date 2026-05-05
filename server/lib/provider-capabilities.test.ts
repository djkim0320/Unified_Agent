import { describe, expect, it } from "vitest";
import {
  buildCapabilitiesByModel,
  getProviderModelCapabilities,
} from "./provider-capabilities.js";

describe("provider model capabilities", () => {
  it("returns rich defaults for known provider models", () => {
    expect(getProviderModelCapabilities("openai", "gpt-5.5")).toEqual(
      expect.objectContaining({
        streaming: true,
        jsonMode: true,
        reasoningLevel: true,
        maxContextTokens: 1_000_000,
      }),
    );

    expect(getProviderModelCapabilities("ollama", "deepseek-r1:8b")).toEqual(
      expect.objectContaining({
        streaming: true,
        reasoningLevel: true,
      }),
    );
  });

  it("falls back conservatively for unknown local models", () => {
    expect(getProviderModelCapabilities("ollama", "unknown-local-model")).toEqual(
      expect.objectContaining({
        streaming: true,
        jsonMode: false,
        maxContextTokens: null,
      }),
    );
  });

  it("builds a capabilities map for model list responses", () => {
    expect(buildCapabilitiesByModel("openai", ["gpt-5.5"])).toEqual({
      "gpt-5.5": expect.objectContaining({
        jsonMode: true,
      }),
    });
  });
});
