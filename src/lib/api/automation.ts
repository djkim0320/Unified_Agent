import { apiRequest } from "../../apiClient";
import type {
  AutomationRuleRecord,
  ConversationRecord,
  ProviderKind,
  ReasoningLevel,
  TaskRecord,
} from "../../types";

export async function listAgentAutomationRules(agentId: string, signal?: AbortSignal) {
  return apiRequest<{ rules: AutomationRuleRecord[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/automation-rules`,
    { signal },
  );
}

export async function createAgentAutomationRule(
  agentId: string,
  payload: {
    conversationId?: string | null;
    title: string;
    prompt: string;
    providerKind?: ProviderKind;
    model?: string;
    reasoningLevel?: ReasoningLevel;
    enabled?: boolean;
    intervalMinutes: number;
    nextRunAt?: number;
  },
) {
  return apiRequest<{ rule: AutomationRuleRecord; conversation?: ConversationRecord }>(
    `/api/agents/${encodeURIComponent(agentId)}/automation-rules`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function updateAgentAutomationRule(
  agentId: string,
  ruleId: string,
  payload: Partial<{
    title: string;
    prompt: string;
    providerKind: ProviderKind;
    model: string;
    reasoningLevel: ReasoningLevel;
    enabled: boolean;
    intervalMinutes: number;
    nextRunAt: number;
  }>,
) {
  return apiRequest<{ rule: AutomationRuleRecord | null }>(
    `/api/agents/${encodeURIComponent(agentId)}/automation-rules/${encodeURIComponent(ruleId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export async function deleteAgentAutomationRule(agentId: string, ruleId: string) {
  return apiRequest<{ ok: boolean; ruleId: string }>(
    `/api/agents/${encodeURIComponent(agentId)}/automation-rules/${encodeURIComponent(ruleId)}`,
    { method: "DELETE" },
  );
}

export async function triggerAgentAutomationRule(agentId: string, ruleId: string) {
  return apiRequest<{
    rule: AutomationRuleRecord;
    task: TaskRecord;
    message?: string;
  }>(`/api/agents/${encodeURIComponent(agentId)}/automation-rules/${encodeURIComponent(ruleId)}/trigger`, {
    method: "POST",
  });
}
