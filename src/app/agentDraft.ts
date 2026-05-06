import type { AgentDraft } from "../components/AgentSettingsDialog";
import { normalizeReasoningLevel } from "../reasoning-options";
import {
  defaultModels,
  defaultReasoningLevels,
  type AgentRecord,
} from "../types";

export function createAgentDraft(agent: AgentRecord | null): AgentDraft {
  const providerKind = agent?.providerKind ?? "openai";
  const model = agent?.model ?? defaultModels[providerKind];
  return {
    name: agent?.name ?? "기본 에이전트",
    providerKind,
    model,
    reasoningLevel: normalizeReasoningLevel(
      providerKind,
      model,
      agent?.reasoningLevel ?? defaultReasoningLevels[providerKind],
    ),
  };
}
