import { apiRequest, buildHeaders } from "../../apiClient";
import type {
  ArtifactDiffResponse,
  ArtifactPreviewResponse,
  ArtifactRecord,
  ConversationRecord,
  RunDebugResponse,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
} from "../../types";

export async function listWorkspaceRuns(
  conversationId: string,
  signal?: AbortSignal,
) {
  return apiRequest<{ runs: WorkspaceRunRecord[] }>(
    `/api/workspace/runs?conversationId=${encodeURIComponent(conversationId)}`,
    { signal },
  );
}

export async function listRunArtifacts(
  conversationId: string,
  runId: string,
  signal?: AbortSignal,
) {
  const searchParams = new URLSearchParams({ conversationId });
  return apiRequest<{ artifacts: ArtifactRecord[] }>(
    `/api/runs/${encodeURIComponent(runId)}/artifacts?${searchParams.toString()}`,
    { signal },
  );
}

export async function previewArtifact(
  artifactId: string,
  signal?: AbortSignal,
  mode: "redacted" | "full" = "redacted",
) {
  const query = mode === "full" ? "?mode=full" : "";
  return apiRequest<ArtifactPreviewResponse>(
    `/api/artifacts/${encodeURIComponent(artifactId)}/preview${query}`,
    mode === "full"
      ? { signal, headers: await buildHeaders({ method: "POST" }) }
      : { signal },
  );
}

export async function getArtifactDiff(artifactId: string, signal?: AbortSignal) {
  return apiRequest<ArtifactDiffResponse>(
    `/api/artifacts/${encodeURIComponent(artifactId)}/diff`,
    { signal },
  );
}

export async function getRunDebug(conversationId: string, runId: string, signal?: AbortSignal) {
  const searchParams = new URLSearchParams({ conversationId });
  return apiRequest<RunDebugResponse>(
    `/api/runs/${encodeURIComponent(runId)}/debug?${searchParams.toString()}`,
    { signal },
  );
}

export async function searchOperations(params: {
  q: string;
  agentId?: string | null;
  conversationId?: string | null;
  signal?: AbortSignal;
}) {
  const searchParams = new URLSearchParams({ q: params.q });
  if (params.agentId) searchParams.set("agentId", params.agentId);
  if (params.conversationId) searchParams.set("conversationId", params.conversationId);
  return apiRequest<{
    query: string;
    redacted: boolean;
    indexMode: string;
    results: Array<Record<string, unknown>>;
  }>(`/api/search?${searchParams.toString()}`, { signal: params.signal });
}

export async function exportConversation(conversationId: string, mode: "redacted" | "full" = "redacted") {
  const query = mode === "full" ? "?mode=full" : "";
  return apiRequest<Record<string, unknown>>(
    `/api/conversations/${encodeURIComponent(conversationId)}/export${query}`,
    mode === "full" ? { headers: await buildHeaders({ method: "POST" }) } : undefined,
  );
}

export async function listWorkspaceRunEvents(
  conversationId: string,
  runId: string,
  signal?: AbortSignal,
) {
  const searchParams = new URLSearchParams({
    conversationId,
  });
  return apiRequest<{ events: WorkspaceRunEventRecord[] }>(
    `/api/workspace/runs/${encodeURIComponent(runId)}/events?${searchParams.toString()}`,
    { signal },
  );
}
