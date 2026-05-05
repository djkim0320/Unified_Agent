import type { ProviderKind } from "./types";

export interface ModelOption {
  id: string;
  label: string;
  note: string;
}

const catalog: Record<ProviderKind, ModelOption[]> = {
  openai: [
    {
      id: "gpt-5.5",
      label: "GPT-5.5",
      note: "복잡한 추론, 코딩, 장기 에이전트 작업에 맞춘 최신 고성능 모델",
    },
    {
      id: "gpt-5.4",
      label: "GPT-5.4",
      note: "전문 작업과 장기 실행에 안정적인 프런티어 모델",
    },
    {
      id: "gpt-5.4-mini",
      label: "GPT-5.4 Mini",
      note: "빠른 응답과 비용 효율이 중요한 일상 작업용 모델",
    },
    {
      id: "gpt-5.4-nano",
      label: "GPT-5.4 Nano",
      note: "간단한 지시와 초저지연 작업에 맞춘 경량 모델",
    },
  ],
  anthropic: [
    {
      id: "claude-opus-4-7",
      label: "Claude Opus 4.7",
      note: "복잡한 추론과 에이전트 코딩에 강한 최상위 Claude 모델",
    },
    {
      id: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      note: "속도와 품질 균형이 좋은 범용 Claude 모델",
    },
    {
      id: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      note: "빠른 응답이 필요한 가벼운 작업용 Claude 모델",
    },
  ],
  gemini: [
    {
      id: "gemini-3.1-pro-preview",
      label: "Gemini 3.1 Pro Preview",
      note: "긴 컨텍스트와 복잡한 에이전트 워크플로우에 적합한 Gemini 모델",
    },
    {
      id: "gemini-3.1-pro-preview-customtools",
      label: "Gemini 3.1 Pro Preview",
      note: "opencode MCP/확장 설정과 함께 쓰기 좋은 Gemini 모델 별칭",
    },
    {
      id: "gemini-3-flash-preview",
      label: "Gemini 3 Flash Preview",
      note: "빠른 응답과 범용 작업 균형이 좋은 Gemini 모델",
    },
    {
      id: "gemini-3.1-flash-lite-preview",
      label: "Gemini 3.1 Flash-Lite Preview",
      note: "가벼운 요청에 최적화된 저지연 Gemini 모델",
    },
  ],
  ollama: [
    {
      id: "qwen3",
      label: "Qwen 3",
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
      note: "가벼운 로컬 추론과 메모리 제한 환경에 맞춘 모델",
    },
  ],
  "openai-codex": [
    {
      id: "gpt-5.5",
      label: "GPT-5.5",
      note: "ChatGPT/OAuth로 연결한 Codex에서 권장하는 최신 모델",
    },
    {
      id: "gpt-5.4",
      label: "GPT-5.4",
      note: "GPT-5.5를 사용할 수 없을 때 안정적인 Codex 대안",
    },
    {
      id: "gpt-5.4-mini",
      label: "GPT-5.4 Mini",
      note: "가벼운 코딩 작업과 빠른 하위 에이전트 작업용 모델",
    },
    {
      id: "gpt-5.3-codex",
      label: "GPT-5.3 Codex",
      note: "복잡한 소프트웨어 작업에 특화된 Codex 모델",
    },
    {
      id: "gpt-5.3-codex-spark",
      label: "GPT-5.3 Codex Spark",
      note: "빠른 반복 작업에 적합한 Codex 모델",
    },
    {
      id: "gpt-5.2",
      label: "GPT-5.2",
      note: "이전 세대의 안정적인 장기 작업 모델",
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
      note: "직접 입력한 모델",
    }
  );
}
