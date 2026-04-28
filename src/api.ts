import type {
  AgentMemoryRecord,
  AgentRecord,
  AgentSkillSummary,
  AgentHeartbeatRecord,
  ConversationRecord,
  ComputerUseApprovalRecord,
  ComputerUseSessionDetail,
  ComputerUseSessionRecord,
  ComputerUseSettingsRecord,
  HeartbeatLogRecord,
  AgentSoulRecord,
  MemorySearchResult,
  MessageRecord,
  PlatformMetadata,
  PluginManifest,
  ProviderKind,
  ProviderSummary,
  ReasoningLevel,
  StandingOrdersRecord,
  StreamEventPayloadMap,
  ToolDescriptor,
  TaskFlowRecord,
  TaskFlowStepDraft,
  TaskFlowStepDetail,
  WorkspaceFileRecord,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
  WorkspaceScope,
  WorkspaceTreeNode,
  ChannelSummary,
  TaskEventRecord,
  TaskRecord,
  ProviderModelCapabilities,
  EngineRunRecord,
  EngineStatusRecord,
  EngineAuthLoginResult,
} from "./types";
import { apiRequest, buildHeaders, readJsonOrThrow } from "./apiClient";

export async function listProviders() {
  return apiRequest<{ providers: ProviderSummary[] }>("/api/providers");
}

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

export async function listPlugins(signal?: AbortSignal) {
  return apiRequest<{ plugins: PluginManifest[] }>("/api/plugins", { signal });
}

export async function createMcpServerProfile(payload: {
  label: string;
  transport?: "stdio" | "http" | "mock";
  command?: string;
  description?: string;
  enabled?: boolean;
}) {
  return apiRequest<{ plugin: PluginManifest; plugins: PluginManifest[] }>("/api/mcp/servers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listTools(signal?: AbortSignal) {
  return apiRequest<{ tools: ToolDescriptor[] }>("/api/tools", { signal });
}

export async function listChannels(signal?: AbortSignal) {
  return apiRequest<{ channels: ChannelSummary[] }>("/api/channels", { signal });
}

export async function getComputerUseSettings(signal?: AbortSignal) {
  return apiRequest<{ settings: ComputerUseSettingsRecord }>("/api/computer-use/settings", {
    signal,
  });
}

export async function saveComputerUseSettings(payload: {
  enabled: boolean;
  customBrowserHarnessEnabled?: boolean;
  allowExternalDomains?: string[];
  allowFileUrls?: boolean;
  maxActionsPerSession?: number;
  sessionTimeoutMs?: number;
}) {
  return apiRequest<{ settings: ComputerUseSettingsRecord }>("/api/computer-use/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function createComputerUseSession(payload: {
  agentId?: string | null;
  conversationId?: string | null;
  runId?: string | null;
  taskId?: string | null;
  allowedDomains?: string[];
}) {
  return apiRequest<{
    session: ComputerUseSessionRecord;
    events: ComputerUseSessionDetail["events"];
    approvals: ComputerUseSessionDetail["approvals"];
  }>("/api/computer-use/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getComputerUseSession(sessionId: string, signal?: AbortSignal) {
  return apiRequest<ComputerUseSessionDetail>(
    `/api/computer-use/sessions/${encodeURIComponent(sessionId)}`,
    { signal },
  );
}

export async function closeComputerUseSession(sessionId: string) {
  return apiRequest<{ session: ComputerUseSessionRecord | null }>(
    `/api/computer-use/sessions/${encodeURIComponent(sessionId)}/close`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export async function approveComputerUseAction(
  sessionId: string,
  payload: { actionEventId?: string | null; reason?: string | null },
) {
  return apiRequest<{
    approval: ComputerUseApprovalRecord;
    detail: ComputerUseSessionDetail;
  }>(`/api/computer-use/sessions/${encodeURIComponent(sessionId)}/approve`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function denyComputerUseAction(
  sessionId: string,
  payload: { actionEventId?: string | null; reason?: string | null },
) {
  return apiRequest<{
    approval: ComputerUseApprovalRecord;
    detail: ComputerUseSessionDetail;
  }>(`/api/computer-use/sessions/${encodeURIComponent(sessionId)}/deny`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function navigateComputerUseSession(sessionId: string, url: string) {
  return apiRequest<Record<string, unknown>>(
    `/api/computer-use/sessions/${encodeURIComponent(sessionId)}/navigate`,
    {
      method: "POST",
      body: JSON.stringify({ url }),
    },
  );
}

export async function screenshotComputerUseSession(sessionId: string) {
  return apiRequest<Record<string, unknown>>(
    `/api/computer-use/sessions/${encodeURIComponent(sessionId)}/screenshot`,
    {
      method: "POST",
      body: JSON.stringify({ fullPage: false }),
    },
  );
}

export async function clickComputerUseSession(
  sessionId: string,
  payload: {
    selector: string;
    visibleText?: string;
    maySubmit?: boolean;
    mayChangeState?: boolean;
    mayDelete?: boolean;
    mayUpload?: boolean;
    mayDownload?: boolean;
    mayPurchase?: boolean;
  },
) {
  return apiRequest<Record<string, unknown>>(
    `/api/computer-use/sessions/${encodeURIComponent(sessionId)}/click`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function typeComputerUseSession(
  sessionId: string,
  payload: {
    selector: string;
    text: string;
    typedTextKind?: "plain" | "password" | "token" | "api_key" | "payment" | "email" | "personal";
    submit?: boolean;
  },
) {
  return apiRequest<Record<string, unknown>>(
    `/api/computer-use/sessions/${encodeURIComponent(sessionId)}/type`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function listAgentSkills(agentId: string, signal?: AbortSignal) {
  return apiRequest<{ agentId: string; skills: AgentSkillSummary[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/skills`,
    { signal },
  );
}

export async function createAgentSkill(
  agentId: string,
  payload: { name: string; content: string; scope?: "agent" | "shared" },
) {
  return apiRequest<{
    agentId: string;
    skill: { name: string; source: "agent" | "shared"; path: string };
    skills: AgentSkillSummary[];
  }>(`/api/agents/${encodeURIComponent(agentId)}/skills`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listPlatformMetadata(
  agentId?: string | null,
  signal?: AbortSignal,
): Promise<PlatformMetadata> {
  const [pluginsResponse, channelsResponse] = await Promise.all([
    listPlugins(signal),
    listChannels(signal),
  ]);

  return {
    plugins: pluginsResponse.plugins,
    tools: [],
    channels: channelsResponse.channels,
    agentSkills: [],
  };
}

export async function getAgentMemory(agentId: string, signal?: AbortSignal) {
  return apiRequest<{ memory: AgentMemoryRecord }>(
    `/api/agents/${encodeURIComponent(agentId)}/memory`,
    { signal },
  );
}

export async function writeAgentMemory(agentId: string, payload: { content: string; target?: "durable" | "daily" }) {
  return apiRequest<{ memory: AgentMemoryRecord }>(`/api/agents/${encodeURIComponent(agentId)}/memory`, {
    method: "POST",
    body: JSON.stringify(payload),
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

export async function searchAgentMemory(
  agentId: string,
  params: { query: string; maxResults?: number },
  signal?: AbortSignal,
) {
  const searchParams = new URLSearchParams({ query: params.query });
  if (typeof params.maxResults === "number") {
    searchParams.set("maxResults", String(params.maxResults));
  }
  return apiRequest<{ results: MemorySearchResult[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/memory/search?${searchParams.toString()}`,
    { signal },
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
  return apiRequest<{ flow: TaskFlowRecord; steps: TaskFlowStepDetail[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/flows`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function getTaskFlow(flowId: string, signal?: AbortSignal) {
  return apiRequest<{ flow: TaskFlowRecord; steps: TaskFlowStepDetail[] }>(
    `/api/flows/${encodeURIComponent(flowId)}`,
    { signal },
  );
}

export async function saveTaskFlowSteps(
  flowId: string,
  steps: TaskFlowStepDraft[],
  title?: string,
) {
  return apiRequest<{ flow: TaskFlowRecord; steps: TaskFlowStepDetail[] }>(
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
  return apiRequest<{ flow: TaskFlowRecord; steps: TaskFlowStepDetail[] }>(
    `/api/flows/${encodeURIComponent(flowId)}/start`,
    { method: "POST" },
  );
}

export async function resumeTaskFlow(flowId: string) {
  return apiRequest<{ flow: TaskFlowRecord; steps: TaskFlowStepDetail[] }>(
    `/api/flows/${encodeURIComponent(flowId)}/resume`,
    { method: "POST" },
  );
}

export async function retryTaskFlowStep(flowId: string, stepId: string) {
  return apiRequest<{ flow: TaskFlowRecord; steps: TaskFlowStepDetail[] }>(
    `/api/flows/${encodeURIComponent(flowId)}/steps/${encodeURIComponent(stepId)}/retry`,
    { method: "POST" },
  );
}

export async function skipTaskFlowStep(flowId: string, stepId: string) {
  return apiRequest<{ flow: TaskFlowRecord; steps: TaskFlowStepDetail[] }>(
    `/api/flows/${encodeURIComponent(flowId)}/steps/${encodeURIComponent(stepId)}/skip`,
    { method: "POST" },
  );
}

export async function listTaskEvents(agentId: string, taskId: string, signal?: AbortSignal) {
  return apiRequest<{ events: TaskEventRecord[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/tasks/${encodeURIComponent(taskId)}/events`,
    { signal },
  );
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
  return apiRequest<{
    models: string[];
    capabilitiesByModel?: Record<string, ProviderModelCapabilities>;
  }>(`/api/providers/${kind}/models`);
}

export async function getEngineStatus(signal?: AbortSignal) {
  return apiRequest<EngineStatusRecord>("/api/engine/status", { signal });
}

export async function refreshOpenCodeModels() {
  return apiRequest<{ ok: boolean; models: string[]; message: string }>(
    "/api/engine/opencode/refresh-models",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function startOpenCodeAuthLogin(payload?: {
  provider?: string;
  method?: string | null;
  launch?: boolean;
}) {
  return apiRequest<EngineAuthLoginResult>("/api/engine/opencode/auth/login", {
    method: "POST",
    body: JSON.stringify(payload ?? { provider: "openai", launch: true }),
  });
}

export async function getEngineRun(runId: string, signal?: AbortSignal) {
  return apiRequest<{ engineRun: EngineRunRecord }>(
    `/api/engine/runs/${encodeURIComponent(runId)}`,
    { signal },
  );
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
  return apiRequest<{ provider: ProviderSummary }>("/api/providers/openai-codex/import-cli-auth", {
    method: "POST",
  });
}

export async function logoutCodex() {
  return apiRequest<{ ok: boolean }>("/api/providers/openai-codex/logout", {
    method: "POST",
  });
}

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

export async function getWorkspaceTree(params: {
  conversationId: string;
  scope: WorkspaceScope;
  path?: string;
  maxDepth?: number;
  signal?: AbortSignal;
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
  }>(`/api/workspace/tree?${searchParams.toString()}`, { signal: params.signal });
}

export async function getWorkspaceFile(params: {
  conversationId: string;
  scope: WorkspaceScope;
  path: string;
  signal?: AbortSignal;
}) {
  const searchParams = new URLSearchParams({
    conversationId: params.conversationId,
    scope: params.scope,
    path: params.path,
  });
  return apiRequest<{
    file: WorkspaceFileRecord;
  }>(`/api/workspace/file?${searchParams.toString()}`, { signal: params.signal });
}

export async function createWorkspaceFile(params: {
  conversationId: string;
  scope: Extract<WorkspaceScope, "sandbox" | "shared">;
  path: string;
  content?: string;
  overwrite?: boolean;
}) {
  return apiRequest<{
    file: WorkspaceFileRecord;
  }>("/api/workspace/file", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function createWorkspaceFolder(params: {
  conversationId: string;
  scope: Extract<WorkspaceScope, "sandbox" | "shared">;
  path: string;
}) {
  return apiRequest<{
    folder: {
      scope: Extract<WorkspaceScope, "sandbox" | "shared">;
      path: string;
    };
  }>("/api/workspace/folder", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function listWorkspaceRuns(
  conversationId: string,
  signal?: AbortSignal,
) {
  return apiRequest<{ runs: WorkspaceRunRecord[] }>(
    `/api/workspace/runs?conversationId=${encodeURIComponent(conversationId)}`,
    { signal },
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
  signal?: AbortSignal,
) {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: await buildHeaders({ method: "POST" }),
    body: JSON.stringify(payload),
    signal,
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
