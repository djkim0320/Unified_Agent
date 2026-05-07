import { apiRequest } from "../../apiClient";
import type {
  FlowDraft,
  TaskFlowDetailResponse,
  TaskFlowRecord,
  TaskFlowStepDetail,
  TaskFlowStepDraft,
} from "../../types";

export async function listTaskFlows(agentId: string, signal?: AbortSignal) {
  return apiRequest<{ flows: TaskFlowRecord[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/flows`,
    { signal },
  );
}

export async function createTaskFlow(
  agentId: string,
  payload: {
    conversationId?: string | null;
    title: string;
    autoStart?: boolean;
    steps: Array<{
      stepKey: string;
      title: string;
      prompt: string;
      dependencyStepKey?: string | null;
    }>;
  },
) {
  return apiRequest<TaskFlowDetailResponse>(
    `/api/agents/${encodeURIComponent(agentId)}/flows`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function draftFlowFromPrompt(
  agentId: string,
  payload: {
    conversationId?: string | null;
    prompt: string;
    title?: string | null;
  },
) {
  return apiRequest<{ draft: FlowDraft }>(
    `/api/agents/${encodeURIComponent(agentId)}/flows/draft`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function getTaskFlow(flowId: string, signal?: AbortSignal) {
  return apiRequest<TaskFlowDetailResponse>(
    `/api/flows/${encodeURIComponent(flowId)}`,
    { signal },
  );
}

export async function saveTaskFlowSteps(
  flowId: string,
  steps: TaskFlowStepDraft[],
  title?: string,
) {
  return apiRequest<TaskFlowDetailResponse>(
    `/api/flows/${encodeURIComponent(flowId)}/steps`,
    {
      method: "PUT",
      body: JSON.stringify({ steps, ...(title ? { title } : {}) }),
    },
  );
}

export async function deleteTaskFlow(flowId: string) {
  return apiRequest<{ ok: true; flowId: string }>(`/api/flows/${encodeURIComponent(flowId)}`, {
    method: "DELETE",
  });
}

export async function cancelTaskFlow(flowId: string) {
  return apiRequest<{ flow: TaskFlowRecord | null; steps?: TaskFlowStepDetail[] }>(`/api/flows/${encodeURIComponent(flowId)}/cancel`, {
    method: "POST",
  });
}

export async function startTaskFlow(flowId: string) {
  return apiRequest<TaskFlowDetailResponse>(
    `/api/flows/${encodeURIComponent(flowId)}/start`,
    { method: "POST" },
  );
}

export async function resumeTaskFlow(flowId: string) {
  return apiRequest<TaskFlowDetailResponse>(
    `/api/flows/${encodeURIComponent(flowId)}/resume`,
    { method: "POST" },
  );
}

export async function retryTaskFlowStep(flowId: string, stepId: string) {
  return apiRequest<TaskFlowDetailResponse>(
    `/api/flows/${encodeURIComponent(flowId)}/steps/${encodeURIComponent(stepId)}/retry`,
    { method: "POST" },
  );
}

export async function skipTaskFlowStep(flowId: string, stepId: string) {
  return apiRequest<TaskFlowDetailResponse>(
    `/api/flows/${encodeURIComponent(flowId)}/steps/${encodeURIComponent(stepId)}/skip`,
    { method: "POST" },
  );
}

export async function approveTaskFlowStep(flowId: string, stepId: string) {
  return apiRequest<TaskFlowDetailResponse>(
    `/api/flows/${encodeURIComponent(flowId)}/steps/${encodeURIComponent(stepId)}/approve`,
    { method: "POST" },
  );
}

export async function denyTaskFlowStep(flowId: string, stepId: string) {
  return apiRequest<TaskFlowDetailResponse>(
    `/api/flows/${encodeURIComponent(flowId)}/steps/${encodeURIComponent(stepId)}/deny`,
    { method: "POST" },
  );
}
