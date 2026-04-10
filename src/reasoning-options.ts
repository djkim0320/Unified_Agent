import type { ProviderKind, ReasoningLevel } from "./types";

export interface ReasoningOption {
  value: ReasoningLevel;
  label: string;
}

const MINIMAL_TO_HIGH: ReasoningOption[] = [
  { value: "minimal", label: "최소" },
  { value: "low", label: "낮음" },
  { value: "medium", label: "보통" },
  { value: "high", label: "높음" },
];

const LOW_TO_XHIGH: ReasoningOption[] = [
  { value: "low", label: "낮음" },
  { value: "medium", label: "보통" },
  { value: "high", label: "높음" },
  { value: "xhigh", label: "매우 높음" },
];

const LOW_TO_HIGH: ReasoningOption[] = [
  { value: "low", label: "낮음" },
  { value: "medium", label: "보통" },
  { value: "high", label: "높음" },
];

const LOW_TO_MAX: ReasoningOption[] = [
  { value: "low", label: "낮음" },
  { value: "medium", label: "보통" },
  { value: "high", label: "높음" },
  { value: "xhigh", label: "최대" },
];

const FIXED_DEFAULT: ReasoningOption[] = [{ value: "medium", label: "기본" }];

export function getReasoningOptions(
  kind: ProviderKind,
  model: string,
): ReasoningOption[] {
  if (kind === "openai") {
    return MINIMAL_TO_HIGH;
  }

  if (kind === "openai-codex") {
    return LOW_TO_XHIGH;
  }

  if (kind === "anthropic") {
    if (model.startsWith("claude-opus-4-6") || model.startsWith("claude-sonnet-4-6")) {
      return LOW_TO_MAX;
    }

    if (model.startsWith("claude-haiku-4-5")) {
      return LOW_TO_HIGH;
    }

    return LOW_TO_HIGH;
  }

  if (kind === "gemini") {
    if (model.startsWith("gemini-3.1-pro-preview")) {
      return LOW_TO_HIGH;
    }

    if (
      model.startsWith("gemini-3-flash-preview") ||
      model.startsWith("gemini-3.1-flash-lite-preview")
    ) {
      return MINIMAL_TO_HIGH;
    }

    return LOW_TO_HIGH;
  }

  return FIXED_DEFAULT;
}

export function normalizeReasoningLevel(
  kind: ProviderKind,
  model: string,
  value: ReasoningLevel,
): ReasoningLevel {
  const options = getReasoningOptions(kind, model);
  return options.some((option) => option.value === value) ? value : options[0].value;
}

export function getReasoningLabel(
  kind: ProviderKind,
  model: string,
  value: ReasoningLevel,
) {
  const option = getReasoningOptions(kind, model).find((item) => item.value === value);
  return option?.label ?? getReasoningOptions(kind, model)[0].label;
}
