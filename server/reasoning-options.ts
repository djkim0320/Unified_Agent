import type { ProviderKind, ReasoningLevel } from "./types.js";

const MINIMAL_TO_HIGH: ReasoningLevel[] = ["minimal", "low", "medium", "high"];
const LOW_TO_XHIGH: ReasoningLevel[] = ["low", "medium", "high", "xhigh"];
const LOW_TO_HIGH: ReasoningLevel[] = ["low", "medium", "high"];
const LOW_TO_MAX: ReasoningLevel[] = ["low", "medium", "high", "xhigh"];

export function getReasoningOptions(
  kind: ProviderKind,
  model: string,
): ReasoningLevel[] {
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

  return ["medium"];
}

export function normalizeReasoningLevel(
  kind: ProviderKind,
  model: string,
  value: ReasoningLevel | null | undefined,
): ReasoningLevel {
  const options = getReasoningOptions(kind, model);
  if (value && options.includes(value)) {
    return value;
  }
  return options[0];
}

export function getAnthropicAdaptiveEffort(level: ReasoningLevel) {
  if (level === "xhigh") {
    return "max";
  }
  if (level === "high") {
    return "high";
  }
  if (level === "low") {
    return "low";
  }
  return "medium";
}

export function getAnthropicThinkingBudget(level: ReasoningLevel) {
  if (level === "high" || level === "xhigh") {
    return 4096;
  }
  if (level === "medium") {
    return 2048;
  }
  return 1024;
}

export function getGeminiThinkingLevel(level: ReasoningLevel): ReasoningLevel {
  if (level === "xhigh") {
    return "high";
  }
  return level;
}
