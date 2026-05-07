import { apiRequest } from "../../apiClient";
import type {
  ConversationRecord,
  ProviderKind,
  ReasoningLevel,
  TaskDebugResponse,
  TaskEventRecord,
  TaskRecord,
} from "../../types";

export async function listAgentTasks(agentId: string, signal?: AbortSignal) {
  return apiRequest<{ tasks: TaskRecord[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/tasks`,
    { signal },
  );
}

export async function createAgentTask(
  agentId: string,
  payload: {
    conversationId?: string | null;
    title?: string;
    prompt: string;
    providerKind?: ProviderKind;
    model?: string;
    reasoningLevel?: ReasoningLevel;
    autoStart?: boolean;
  },
) {
  return apiRequest<{ task: TaskRecord }>(`/api/agents/${encodeURIComponent(agentId)}/tasks`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function cancelAgentTask(agentId: string, taskId: string) {
  return apiRequest<{ task: TaskRecord }>(
    `/api/agents/${encodeURIComponent(agentId)}/tasks/${encodeURIComponent(taskId)}/cancel`,
    { method: "POST" },
  );
}

export async function retryAgentTask(
  agentId: string,
  taskId: string,
  payload?: { autoStart?: boolean; force?: boolean },
) {
  return apiRequest<{ task: TaskRecord; parentTask: TaskRecord }>(
    `/api/agents/${encodeURIComponent(agentId)}/tasks/${encodeURIComponent(taskId)}/retry`,
    {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    },
  );
}

export async function listTaskEvents(agentId: string, taskId: string, signal?: AbortSignal) {
  return apiRequest<{ events: TaskEventRecord[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/tasks/${encodeURIComponent(taskId)}/events`,
    { signal },
  );
}

export async function getTaskDebug(agentId: string, taskId: string, signal?: AbortSignal) {
  return apiRequest<TaskDebugResponse>(
    `/api/agents/${encodeURIComponent(agentId)}/tasks/${encodeURIComponent(taskId)}/debug`,
    { signal },
  );
}

export async function listSubagentSessions(sessionId: string, signal?: AbortSignal) {
  return apiRequest<{ sessions: ConversationRecord[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/subagents`,
    { signal },
  );
}

export async function createSubagentSession(
  sessionId: string,
  payload: {
    title?: string;
    prompt: string;
    providerKind?: ProviderKind;
    model?: string;
    reasoningLevel?: ReasoningLevel;
  },
) {
  return apiRequest<{ session: ConversationRecord; task: TaskRecord }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/subagents`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function cancelSubagentSession(sessionId: string) {
  return apiRequest<{ ok: boolean; task?: TaskRecord | null }>(
    `/api/subagents/${encodeURIComponent(sessionId)}/cancel`,
    { method: "POST" },
  );
}
