import type { ProviderKind } from "./types";

export interface ModelOption {
  id: string;
  label: string;
  note: string;
}

const catalog: Record<ProviderKind, ModelOption[]> = {
  openai: [
    {
      id: "gpt-5.4",
      label: "GPT-5.4",
      note: "일반 작업과 추론 모두에 적합한 최신 모델",
    },
    {
      id: "gpt-5.4-mini",
      label: "GPT-5.4 Mini",
      note: "빠른 응답에 적합한 경량 모델",
    },
    {
      id: "gpt-5.4-nano",
      label: "GPT-5.4 Nano",
      note: "가벼운 질의응답에 적합한 초경량 모델",
    },
  ],
  anthropic: [
    {
      id: "claude-opus-4-6",
      label: "Claude Opus 4.6",
      note: "복잡한 작업과 긴 문맥 처리에 강한 상위 모델",
    },
    {
      id: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      note: "일반적인 채팅과 코딩의 균형이 좋은 모델",
    },
    {
      id: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      note: "빠른 응답이 필요한 가벼운 작업용 모델",
    },
  ],
  gemini: [
    {
      id: "gemini-3.1-pro-preview",
      label: "Gemini 3.1 Pro Preview",
      note: "고난도 추론과 긴 문맥에 적합한 고성능 모델",
    },
    {
      id: "gemini-3-flash-preview",
      label: "Gemini 3 Flash Preview",
      note: "빠른 응답과 일반 작업의 균형이 좋은 모델",
    },
    {
      id: "gemini-3.1-flash-lite-preview",
      label: "Gemini 3.1 Flash Lite Preview",
      note: "가벼운 요청에 최적화된 경량 모델",
    },
  ],
  ollama: [
    {
      id: "qwen3",
      label: "Qwen3",
      note: "로컬 실행에 적합한 범용 모델",
    },
    {
      id: "deepseek-r1:8b",
      label: "DeepSeek R1 8B",
      note: "추론 중심의 로컬 모델",
    },
    {
      id: "gemma3:12b",
      label: "Gemma 3 12B",
      note: "가벼운 로컬 추론에 적합한 모델",
    },
  ],
  "openai-codex": [
    {
      id: "gpt-5.4",
      label: "GPT-5.4",
      note: "Codex 작업에 적합한 기본 모델",
    },
    {
      id: "gpt-5.4-mini",
      label: "GPT-5.4 Mini",
      note: "빠른 Codex 작업에 적합한 경량 모델",
    },
    {
      id: "gpt-5.3-codex-spark",
      label: "GPT-5.3 Codex Spark",
      note: "스파크형 코드 보조 모델",
    },
  ],
};

export function getModelCatalog(providerKind: ProviderKind) {
  return catalog[providerKind];
}

export function getModelOption(providerKind: ProviderKind, model: string): ModelOption {
  return (
    catalog[providerKind].find((option) => option.id === model) ?? {
      id: model,
      label: model,
      note: "사용자 지정 모델",
    }
  );
}
