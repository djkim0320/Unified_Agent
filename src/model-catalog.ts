import type { ProviderKind } from "./types";

export interface ModelCatalogEntry {
  id: string;
  label: string;
  note: string;
  matchPrefixes?: string[];
}

const providerModelCatalog: Record<ProviderKind, ModelCatalogEntry[]> = {
  openai: [
    {
      id: "gpt-5.4",
      label: "GPT-5.4",
      note: "가장 균형 좋은 기본 선택",
    },
    {
      id: "gpt-5.4-mini",
      label: "GPT-5.4 Mini",
      note: "더 빠른 일상형 응답",
    },
    {
      id: "gpt-5.4-nano",
      label: "GPT-5.4 Nano",
      note: "가장 빠른 저지연 응답",
    },
  ],
  anthropic: [
    {
      id: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      note: "일반 작업에 가장 균형 좋음",
      matchPrefixes: ["claude-sonnet-4-6"],
    },
    {
      id: "claude-opus-4-6",
      label: "Claude Opus 4.6",
      note: "가장 깊은 추론과 품질",
      matchPrefixes: ["claude-opus-4-6"],
    },
    {
      id: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      note: "가벼운 작업에 빠른 선택",
      matchPrefixes: ["claude-haiku-4-5"],
    },
  ],
  gemini: [
    {
      id: "gemini-3-flash-preview",
      label: "Gemini 3 Flash Preview",
      note: "속도와 사고 깊이의 균형",
      matchPrefixes: ["gemini-3-flash-preview"],
    },
    {
      id: "gemini-3.1-pro-preview",
      label: "Gemini 3.1 Pro Preview",
      note: "가장 높은 분석 성능",
      matchPrefixes: ["gemini-3.1-pro-preview"],
    },
    {
      id: "gemini-3.1-flash-lite-preview",
      label: "Gemini 3.1 Flash-Lite Preview",
      note: "가벼운 요청에 빠르고 경제적",
      matchPrefixes: ["gemini-3.1-flash-lite-preview"],
    },
  ],
  ollama: [
    {
      id: "qwen3",
      label: "Qwen 3",
      note: "로컬 기본 추천",
      matchPrefixes: ["qwen3", "qwen3-coder"],
    },
    {
      id: "deepseek-r1:8b",
      label: "DeepSeek R1 8B",
      note: "추론 중심 로컬 모델",
      matchPrefixes: ["deepseek-r1"],
    },
    {
      id: "gemma3:12b",
      label: "Gemma 3 12B",
      note: "가벼운 멀티모달 선택",
      matchPrefixes: ["gemma3"],
    },
  ],
  "openai-codex": [
    {
      id: "gpt-5.4",
      label: "GPT-5.4",
      note: "범용 코딩과 작업 자동화",
    },
    {
      id: "gpt-5.4-mini",
      label: "GPT-5.4 Mini",
      note: "빠른 반복 작업에 적합",
    },
    {
      id: "gpt-5.3-codex",
      label: "GPT-5.3 Codex",
      note: "에이전트형 코딩 작업에 강함",
    },
    {
      id: "gpt-5.3-codex-spark",
      label: "GPT-5.3 Codex Spark",
      note: "짧은 작업을 빠르게 반복",
    },
    {
      id: "gpt-5.2-codex",
      label: "GPT-5.2 Codex",
      note: "긴 흐름의 안정적인 코딩",
    },
  ],
};

function prettifyModelId(modelId: string) {
  return modelId
    .replace(/[-_:]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getModelCatalog(kind: ProviderKind) {
  return providerModelCatalog[kind];
}

export function getModelOption(kind: ProviderKind, modelId: string): ModelCatalogEntry {
  const direct = providerModelCatalog[kind].find((entry) => entry.id === modelId);
  if (direct) {
    return direct;
  }

  const prefixMatch = providerModelCatalog[kind].find((entry) =>
    (entry.matchPrefixes ?? [entry.id]).some(
      (prefix) => modelId === prefix || modelId.startsWith(`${prefix}-`),
    ),
  );

  if (prefixMatch) {
    return {
      ...prefixMatch,
      id: modelId,
    };
  }

  return {
    id: modelId,
    label: prettifyModelId(modelId),
    note: modelId,
  };
}
