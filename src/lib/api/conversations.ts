import { apiRequest } from "../../apiClient";
import type {
  ConversationRecord,
  MessageRecord,
  ProviderKind,
  ReasoningLevel,
  SessionSummaryRecord,
  SessionSummarySuggestionRecord,
  TaskRecord,
} from "../../types";

export async function listConversations(signal?: AbortSignal, agentId?: string | null) {
  const path = agentId ? `/api/conversations?agentId=${encodeURIComponent(agentId)}` : "/api/conversations";
  return apiRequest<{ conversations: ConversationRecord[] }>(path, { signal });
}

export async function deleteConversation(conversationId: string) {
  return apiRequest<{ ok: boolean }>(`/api/conversations/${conversationId}`, {
    method: "DELETE",
  });
}

export async function saveConversation(payload: {
  conversationId?: string;
  title?: string;
  agentId?: string;
  providerKind?: ProviderKind;
  model?: string;
  reasoningLevel?: ReasoningLevel;
}) {
  return apiRequest<{ conversation: ConversationRecord }>("/api/conversations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getConversationMessages(conversationId: string, signal?: AbortSignal) {
  return apiRequest<{
    conversation: ConversationRecord;
    messages: MessageRecord[];
  }>(`/api/conversations/${conversationId}/messages`, { signal });
}

export async function getConversationSummary(conversationId: string, signal?: AbortSignal) {
  return apiRequest<{ summary: SessionSummaryRecord | null }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/summary`,
    { signal },
  );
}

export async function saveConversationSummary(
  conversationId: string,
  payload: {
    summary: string;
    decisions?: string[];
    openQuestions?: string[];
    nextActions?: string[];
    metadata?: SessionSummaryRecord["metadata"];
  },
) {
  return apiRequest<{ summary: SessionSummaryRecord }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/summary`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export async function refreshConversationSummary(conversationId: string) {
  return apiRequest<{ summary: SessionSummaryRecord }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/summary/refresh`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function refreshConversationSummaryTask(conversationId: string) {
  return apiRequest<{ task: TaskRecord; message: string }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/summary/refresh-task`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function getConversationSummarySuggestions(conversationId: string, signal?: AbortSignal) {
  return apiRequest<{ suggestions: SessionSummarySuggestionRecord[] }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/summary/suggestions`,
    { signal },
  );
}

export async function applyConversationSummarySuggestion(
  conversationId: string,
  payload: {
    summary: string;
    decisions?: string[];
    openQuestions?: string[];
    nextActions?: string[];
    metadata?: SessionSummaryRecord["metadata"];
    taskId?: string;
  },
) {
  return apiRequest<{ summary: SessionSummaryRecord }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/summary/apply-suggestion`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function importConversationBundle(payload: {
  bundle: Record<string, unknown>;
  agentId?: string;
  title?: string;
}) {
  return apiRequest<{ conversation: ConversationRecord; summary: SessionSummaryRecord | null }>(
    "/api/conversations/import",
    { method: "POST", body: JSON.stringify(payload) },
  );
}
