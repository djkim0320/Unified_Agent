import { anthropicAdapter } from "./providers/anthropic.js";
import { geminiAdapter } from "./providers/gemini.js";
import { ollamaAdapter } from "./providers/ollama.js";
import { openAICodexAdapter } from "./providers/openai-codex.js";
import { openAIAdapter } from "./providers/openai.js";
import type { ProviderKind } from "./types.js";

export const providerRegistry = {
  openai: openAIAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  ollama: ollamaAdapter,
  "openai-codex": openAICodexAdapter,
} as const;

export const providerKinds = Object.keys(providerRegistry) as ProviderKind[];

export function getProviderAdapter(kind: ProviderKind) {
  return providerRegistry[kind];
}
