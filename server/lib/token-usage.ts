export interface TokenUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

const EMPTY_USAGE: TokenUsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function firstNumber(object: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const direct = finiteNumber(object[key]);
    if (direct !== null) {
      return direct;
    }
  }
  return 0;
}

function usageFromObject(object: Record<string, unknown>): TokenUsageTotals | null {
  const inputTokens = firstNumber(object, [
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
    "tokensIn",
    "tokens_in",
  ]);
  const outputTokens = firstNumber(object, [
    "outputTokens",
    "output_tokens",
    "completionTokens",
    "completion_tokens",
    "responseTokens",
    "response_tokens",
    "tokensOut",
    "tokens_out",
  ]);
  const cacheReadTokens = firstNumber(object, [
    "cacheReadTokens",
    "cache_read_tokens",
    "cachedTokens",
    "cached_tokens",
  ]);
  const cacheWriteTokens = firstNumber(object, ["cacheWriteTokens", "cache_write_tokens"]);
  const explicitTotal = firstNumber(object, ["totalTokens", "total_tokens", "tokens", "tokenCount", "token_count"]);
  const derivedTotal = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const totalTokens = explicitTotal || derivedTotal;
  if (totalTokens === 0) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
  };
}

function mergeUsage(left: TokenUsageTotals, right: TokenUsageTotals): TokenUsageTotals {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

export function emptyTokenUsage(): TokenUsageTotals {
  return { ...EMPTY_USAGE };
}

export function addTokenUsage(left: TokenUsageTotals, right: TokenUsageTotals | null | undefined) {
  return right ? mergeUsage(left, right) : left;
}

export function extractTokenUsage(payload: unknown): TokenUsageTotals | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const object = payload as Record<string, unknown>;
  const direct = usageFromObject(object);
  if (direct) {
    return direct;
  }

  for (const key of ["usage", "tokenUsage", "token_usage", "metrics", "cost", "summary"]) {
    const value = object[key];
    if (typeof value === "object" && value !== null) {
      const nested = usageFromObject(value as Record<string, unknown>);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

export function aggregateTokenUsage(events: unknown[]) {
  return events.reduce<TokenUsageTotals>((total, event) => addTokenUsage(total, extractTokenUsage(event)), emptyTokenUsage());
}
