import type { ProviderKind } from "./types.js";

export interface ModelCatalogEntry {
  id: string;
  label: string;
  note: string;
  matchPrefixes?: string[];
}

const openAIModels: ModelCatalogEntry[] = [
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    note: "Best overall",
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    note: "Faster daily chat",
  },
  {
    id: "gpt-5.4-nano",
    label: "GPT-5.4 Nano",
    note: "Lowest latency",
  },
];

const anthropicModels: ModelCatalogEntry[] = [
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    note: "Best balance",
    matchPrefixes: ["claude-sonnet-4-6"],
  },
  {
    id: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    note: "Highest quality",
    matchPrefixes: ["claude-opus-4-6"],
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    note: "Fast lightweight pick",
    matchPrefixes: ["claude-haiku-4-5"],
  },
];

const geminiModels: ModelCatalogEntry[] = [
  {
    id: "gemini-3-flash-preview",
    label: "Gemini 3 Flash Preview",
    note: "Best balance",
    matchPrefixes: ["gemini-3-flash-preview"],
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Preview",
    note: "Highest reasoning",
    matchPrefixes: ["gemini-3.1-pro-preview"],
  },
  {
    id: "gemini-3.1-flash-lite-preview",
    label: "Gemini 3.1 Flash-Lite Preview",
    note: "Fastest low-cost option",
    matchPrefixes: ["gemini-3.1-flash-lite-preview"],
  },
];

const ollamaFallbackModels: ModelCatalogEntry[] = [
  {
    id: "qwen3",
    label: "Qwen 3",
    note: "Strong local default",
    matchPrefixes: ["qwen3", "qwen3-coder"],
  },
  {
    id: "deepseek-r1:8b",
    label: "DeepSeek R1 8B",
    note: "Reasoning-focused local model",
    matchPrefixes: ["deepseek-r1"],
  },
  {
    id: "gemma3:12b",
    label: "Gemma 3 12B",
    note: "Compact multimodal pick",
    matchPrefixes: ["gemma3"],
  },
];

const codexModels: ModelCatalogEntry[] = [
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    note: "Best overall",
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    note: "Faster coding turns",
  },
  {
    id: "gpt-5.3-codex",
    label: "GPT-5.3-Codex",
    note: "Strong agentic coding",
  },
  {
    id: "gpt-5.3-codex-spark",
    label: "GPT-5.3-Codex-Spark",
    note: "Fast iteration",
  },
  {
    id: "gpt-5.2-codex",
    label: "GPT-5.2-Codex",
    note: "Reliable long-horizon coding",
  },
];

export const providerModelCatalog: Record<ProviderKind, ModelCatalogEntry[]> = {
  openai: openAIModels,
  anthropic: anthropicModels,
  gemini: geminiModels,
  ollama: ollamaFallbackModels,
  "openai-codex": codexModels,
};

function dedupeModels(models: string[]) {
  return Array.from(new Set(models));
}

function pickLiveCatalogMatch(models: string[], entry: ModelCatalogEntry) {
  const exact = models.find((model) => model === entry.id);
  if (exact) {
    return exact;
  }

  const prefixes = entry.matchPrefixes ?? [entry.id];
  const candidates = models.filter((model) =>
    prefixes.some((prefix) => model === prefix || model.startsWith(`${prefix}-`)),
  );

  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => right.localeCompare(left))[0];
}

function pickOllamaModels(liveModels: string[] | null | undefined) {
  if (!liveModels?.length) {
    return ollamaFallbackModels.map((entry) => entry.id);
  }

  const prioritized: string[] = [];
  for (const entry of ollamaFallbackModels) {
    const match = pickLiveCatalogMatch(liveModels, entry);
    if (match) {
      prioritized.push(match);
    }
  }

  const remainder = [...liveModels]
    .filter((model) => !prioritized.includes(model))
    .sort((left, right) => left.localeCompare(right));

  return dedupeModels([...prioritized, ...remainder]).slice(0, 6);
}

export function getCuratedModelIds(
  kind: ProviderKind,
  liveModels: string[] | null | undefined,
) {
  if (kind === "ollama") {
    return pickOllamaModels(liveModels);
  }

  const catalog = providerModelCatalog[kind];
  if (!liveModels?.length) {
    return catalog.map((entry) => entry.id);
  }

  const curated = catalog
    .map((entry) => pickLiveCatalogMatch(liveModels, entry))
    .filter((value): value is string => Boolean(value));

  return curated.length > 0 ? dedupeModels(curated) : catalog.map((entry) => entry.id);
}
