import type { ProviderKind, ProviderModelCapabilities } from "../types.js";

const defaultCapabilities: ProviderModelCapabilities = {
  streaming: true,
  nativeToolCalling: false,
  jsonMode: false,
  reasoningLevel: false,
  vision: false,
  maxContextTokens: null,
  supportsComputerUse: false,
  supportsBrowserUse: true,
  computerUseMode: "none",
};

function withDefaults(overrides: Partial<ProviderModelCapabilities>): ProviderModelCapabilities {
  return {
    ...defaultCapabilities,
    ...overrides,
  };
}

function openAiCapabilities(model: string): ProviderModelCapabilities {
  const isMiniOrNano = /mini|nano/i.test(model);
  const isLatestGPT5 = /^gpt-5\.(5|4)(?:$|-)/i.test(model);
  const supportsNativeComputerTool = isLatestGPT5 || /\bgpt-4\.1\b|computer|cua/i.test(model);
  return withDefaults({
    nativeToolCalling: true,
    jsonMode: true,
    reasoningLevel: true,
    vision: true,
    maxContextTokens: isLatestGPT5 ? (isMiniOrNano ? 400_000 : 1_000_000) : 256_000,
    supportsComputerUse: true,
    computerUseMode: supportsNativeComputerTool ? "openai-computer-tool" : "custom-browser-harness",
  });
}

function anthropicCapabilities(model: string): ProviderModelCapabilities {
  const isMillionContext =
    model.startsWith("claude-opus-4-7") || model.startsWith("claude-sonnet-4-6");
  return withDefaults({
    nativeToolCalling: true,
    jsonMode: true,
    reasoningLevel: /opus|sonnet/i.test(model),
    vision: true,
    maxContextTokens: isMillionContext ? 1_000_000 : 200_000,
    supportsComputerUse: true,
    computerUseMode: "custom-browser-harness",
  });
}

function geminiCapabilities(): ProviderModelCapabilities {
  return withDefaults({
    nativeToolCalling: true,
    jsonMode: true,
    reasoningLevel: true,
    vision: true,
    maxContextTokens: 1_000_000,
    supportsComputerUse: false,
  });
}

function ollamaCapabilities(model: string): ProviderModelCapabilities {
  return withDefaults({
    streaming: true,
    nativeToolCalling: false,
    jsonMode: /qwen|llama|mistral|gemma/i.test(model),
    reasoningLevel: /r1|qwen3/i.test(model),
    vision: /vision|llava|gemma3/i.test(model),
    maxContextTokens: null,
    supportsComputerUse: false,
  });
}

export function getProviderModelCapabilities(
  kind: ProviderKind,
  model: string,
): ProviderModelCapabilities {
  switch (kind) {
    case "openai":
    case "openai-codex":
      return openAiCapabilities(model);
    case "anthropic":
      return anthropicCapabilities(model);
    case "gemini":
      return geminiCapabilities();
    case "ollama":
      return ollamaCapabilities(model);
    default:
      return defaultCapabilities;
  }
}

export function buildCapabilitiesByModel(kind: ProviderKind, models: string[]) {
  return Object.fromEntries(
    models.map((model) => [model, getProviderModelCapabilities(kind, model)]),
  );
}
