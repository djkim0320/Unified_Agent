import { apiRequest } from "../../apiClient";
import type {
  ConversationRecord,
  McpConfigStatus,
  McpServerSummary,
  McpSnippetValidationResult,
  TaskRecord,
} from "../../types";

export async function getMcpCatalog(signal?: AbortSignal) {
  return apiRequest<{ servers: McpServerSummary[]; boundary: string }>("/api/mcp/catalog", {
    signal,
  });
}

export async function getMcpConfigStatus(signal?: AbortSignal) {
  return apiRequest<{ status: McpConfigStatus }>("/api/mcp/config/status", { signal });
}

export async function createMcpTestRun(payload: {
  agentId: string;
  conversationId?: string | null;
  catalogId?: string;
  serverId?: string;
  autoStart?: boolean;
}) {
  return apiRequest<{
    task: TaskRecord;
    conversation: ConversationRecord;
    prompt: string;
    boundary: string;
  }>("/api/mcp/test-run", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function validateMcpSnippet(snippet: string) {
  return apiRequest<{ validation: McpSnippetValidationResult }>("/api/mcp/config/validate-snippet", {
    method: "POST",
    body: JSON.stringify({ snippet }),
  });
}
