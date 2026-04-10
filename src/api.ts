import type {
  ConversationRecord,
  MessageRecord,
  ProviderKind,
  ProviderSummary,
  ReasoningLevel,
  StreamEventPayloadMap,
  WorkspaceFileRecord,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
  WorkspaceScope,
  WorkspaceTreeNode,
} from "./types";

async function readJsonOrThrow<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(text);
    }
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error?: unknown }).error === "string"
        ? ((payload as { error: string }).error ?? `Request failed (${response.status})`)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
}

async function apiRequest<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return readJsonOrThrow<T>(response);
}

export async function listProviders() {
  return apiRequest<{ providers: ProviderSummary[] }>("/api/providers");
}

export async function saveProviderAccount(
  kind: Exclude<ProviderKind, "openai-codex">,
  payload: { apiKey?: string; baseUrl?: string },
) {
  return apiRequest<{ provider: ProviderSummary }>(`/api/providers/${kind}/account`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function listModels(kind: ProviderKind) {
  return apiRequest<{ models: string[] }>(`/api/providers/${kind}/models`);
}

export async function testProvider(kind: ProviderKind) {
  return apiRequest<{ ok: boolean; message: string }>(`/api/providers/${kind}/test`, {
    method: "POST",
  });
}

export async function startCodexOAuth(frontendOrigin: string) {
  return apiRequest<{ provider: ProviderSummary; message: string }>(
    "/api/providers/openai-codex/oauth/start",
    {
      method: "POST",
      body: JSON.stringify({ frontendOrigin, mode: "official-cli" }),
    },
  );
}

export async function importCodexCliAuth() {
  return apiRequest<{ provider: ProviderSummary }>(
    "/api/providers/openai-codex/import-cli-auth",
    {
      method: "POST",
    },
  );
}

export async function logoutCodex() {
  return apiRequest<{ ok: boolean }>("/api/providers/openai-codex/logout", {
    method: "POST",
  });
}

export async function listConversations() {
  return apiRequest<{ conversations: ConversationRecord[] }>("/api/conversations");
}

export async function deleteConversation(conversationId: string) {
  return apiRequest<{ ok: boolean }>(`/api/conversations/${conversationId}`, {
    method: "DELETE",
  });
}

export async function saveConversation(payload: {
  conversationId?: string;
  title?: string;
  providerKind?: ProviderKind;
  model?: string;
  reasoningLevel?: ReasoningLevel;
}) {
  return apiRequest<{ conversation: ConversationRecord }>("/api/conversations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getConversationMessages(conversationId: string) {
  return apiRequest<{
    conversation: ConversationRecord;
    messages: MessageRecord[];
  }>(`/api/conversations/${conversationId}/messages`);
}

export async function getWorkspaceTree(params: {
  conversationId: string;
  scope: WorkspaceScope;
  path?: string;
  maxDepth?: number;
}) {
  const searchParams = new URLSearchParams({
    conversationId: params.conversationId,
    scope: params.scope,
  });
  if (params.path) {
    searchParams.set("path", params.path);
  }
  if (typeof params.maxDepth === "number") {
    searchParams.set("maxDepth", String(params.maxDepth));
  }
  return apiRequest<{
    scope: WorkspaceScope;
    path: string;
    tree: WorkspaceTreeNode[];
    workspaceRoot: string;
  }>(`/api/workspace/tree?${searchParams.toString()}`);
}

export async function getWorkspaceFile(params: {
  conversationId: string;
  scope: WorkspaceScope;
  path: string;
}) {
  const searchParams = new URLSearchParams({
    conversationId: params.conversationId,
    scope: params.scope,
    path: params.path,
  });
  return apiRequest<{
    file: WorkspaceFileRecord;
  }>(`/api/workspace/file?${searchParams.toString()}`);
}

export async function listWorkspaceRuns(conversationId: string) {
  return apiRequest<{ runs: WorkspaceRunRecord[] }>(
    `/api/workspace/runs?conversationId=${encodeURIComponent(conversationId)}`,
  );
}

export async function listWorkspaceRunEvents(runId: string) {
  return apiRequest<{ events: WorkspaceRunEventRecord[] }>(
    `/api/workspace/runs/${encodeURIComponent(runId)}/events`,
  );
}

function flushSseEvent(
  eventName: keyof StreamEventPayloadMap | "message",
  dataLines: string[],
  onEvent: <K extends keyof StreamEventPayloadMap>(
    eventName: K,
    payload: StreamEventPayloadMap[K],
  ) => void,
) {
  if (!dataLines.length || eventName === "message") {
    return;
  }

  const payloadText = dataLines.join("\n");
  const payload = JSON.parse(payloadText) as StreamEventPayloadMap[typeof eventName];
  onEvent(eventName, payload);
}

export async function streamChat(
  payload: {
    conversationId: string;
    providerKind: ProviderKind;
    model: string;
    reasoningLevel: ReasoningLevel;
    message: string;
  },
  onEvent: <K extends keyof StreamEventPayloadMap>(
    eventName: K,
    eventPayload: StreamEventPayloadMap[K],
  ) => void,
) {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await readJsonOrThrow(response);
    return;
  }

  if (!response.body) {
    throw new Error("Streaming response body is missing");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName: keyof StreamEventPayloadMap | "message" = "message";
  let dataLines: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        break;
      }

      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }

      if (!line) {
        flushSseEvent(eventName, dataLines, onEvent);
        eventName = "message";
        dataLines = [];
        continue;
      }

      if (line.startsWith("event:")) {
        const nextEventName = line.slice(6).trim();
        if (
          nextEventName === "status" ||
          nextEventName === "tool_call" ||
          nextEventName === "tool_result" ||
          nextEventName === "run_complete" ||
          nextEventName === "delta" ||
          nextEventName === "done" ||
          nextEventName === "error"
        ) {
          eventName = nextEventName;
        }
        continue;
      }

      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
  }

  flushSseEvent(eventName, dataLines, onEvent);
}
