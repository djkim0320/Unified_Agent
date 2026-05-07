import { apiRequest } from "../../apiClient";
import type {
  AgentHeartbeatRecord,
  AgentRecord,
  AgentSoulRecord,
  ConversationRecord,
  HeartbeatLogRecord,
  ProviderKind,
  ReasoningLevel,
  StandingOrdersRecord,
  TaskRecord,
} from "../../types";

export async function listAgents() {
  return apiRequest<{ agents: AgentRecord[] }>("/api/agents");
}

export async function saveAgent(payload: {
  agentId?: string;
  name: string;
  providerKind?: ProviderKind;
  model?: string;
  reasoningLevel?: ReasoningLevel;
}) {
  return apiRequest<{ agent: AgentRecord }>("/api/agents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteAgent(agentId: string) {
  return apiRequest<{ ok: boolean }>(`/api/agents/${encodeURIComponent(agentId)}`, {
    method: "DELETE",
  });
}

export async function getAgentSoul(agentId: string, signal?: AbortSignal) {
  return apiRequest<{ soul: AgentSoulRecord }>(
    `/api/agents/${encodeURIComponent(agentId)}/soul`,
    { signal },
  );
}

export async function saveAgentSoul(agentId: string, payload: { content: string }) {
  return apiRequest<{ soul: AgentSoulRecord }>(`/api/agents/${encodeURIComponent(agentId)}/soul`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function getAgentStandingOrders(agentId: string, signal?: AbortSignal) {
  return apiRequest<{ standingOrders: StandingOrdersRecord }>(
    `/api/agents/${encodeURIComponent(agentId)}/standing-orders`,
    { signal },
  );
}

export async function saveAgentStandingOrders(agentId: string, payload: { content: string }) {
  return apiRequest<{ standingOrders: StandingOrdersRecord }>(
    `/api/agents/${encodeURIComponent(agentId)}/standing-orders`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export async function getAgentHeartbeat(agentId: string, signal?: AbortSignal) {
  return apiRequest<{ heartbeat: AgentHeartbeatRecord }>(
    `/api/agents/${encodeURIComponent(agentId)}/heartbeat`,
    { signal },
  );
}

export async function saveAgentHeartbeat(
  agentId: string,
  payload: { enabled: boolean; intervalMinutes: number; instructions: string },
) {
  return apiRequest<{ heartbeat: AgentHeartbeatRecord }>(
    `/api/agents/${encodeURIComponent(agentId)}/heartbeat`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export async function triggerAgentHeartbeat(agentId: string) {
  return apiRequest<{
    ok?: boolean;
    message?: string;
    heartbeat?: AgentHeartbeatRecord;
    task?: TaskRecord;
    conversation?: ConversationRecord;
    log?: HeartbeatLogRecord;
    heartbeatLog?: HeartbeatLogRecord;
  }>(`/api/agents/${encodeURIComponent(agentId)}/heartbeat/trigger`, {
    method: "POST",
  });
}

export async function listHeartbeatLogs(agentId: string, signal?: AbortSignal) {
  return apiRequest<{ logs: HeartbeatLogRecord[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/heartbeat/logs`,
    { signal },
  );
}
