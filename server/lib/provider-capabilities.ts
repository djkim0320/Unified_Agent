import type { ProviderKind, ProviderModelCapabilities } from "../types.js";

const defaultCapabilities: ProviderModelCapabilities = {
  streaming: true,
  jsonMode: false,
  reasoningLevel: false,
  vision: false,
  maxContextTokens: null,
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
  return withDefaults({
    jsonMode: true,
    reasoningLevel: true,
    vision: true,
    maxContextTokens: isLatestGPT5 ? (isMiniOrNano ? 400_000 : 1_000_000) : 256_000,
  });
}

function anthropicCapabilities(model: string): ProviderModelCapabilities {
  const isMillionContext =
    model.startsWith("claude-opus-4-7") || model.startsWith("claude-sonnet-4-6");
  return withDefaults({
    jsonMode: true,
    reasoningLevel: /opus|sonnet/i.test(model),
    vision: true,
    maxContextTokens: isMillionContext ? 1_000_000 : 200_000,
  });
}

function geminiCapabilities(): ProviderModelCapabilities {
  return withDefaults({
    jsonMode: true,
    reasoningLevel: true,
    vision: true,
    maxContextTokens: 1_000_000,
  });
}

function ollamaCapabilities(model: string): ProviderModelCapabilities {
  return withDefaults({
    streaming: true,
    jsonMode: /qwen|llama|mistral|gemma/i.test(model),
    reasoningLevel: /r1|qwen3/i.test(model),
    vision: /vision|llava|gemma3/i.test(model),
    maxContextTokens: null,
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
