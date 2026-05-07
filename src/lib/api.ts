import type {
  AgentRecord,
  AgentHeartbeatRecord,
  AutomationRuleRecord,
  ConversationRecord,
  HeartbeatLogRecord,
  AgentSoulRecord,
  MessageRecord,
  PlatformMetadata,
  PluginManifest,
  ProviderKind,
  ProviderSummary,
  ReasoningLevel,
  StandingOrdersRecord,
  StreamEventPayloadMap,
  TaskFlowDetailResponse,
  TaskFlowRecord,
  TaskFlowStepDraft,
  TaskFlowStepDetail,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
  ChannelSummary,
  TaskEventRecord,
  TaskDebugResponse,
  TaskRecord,
  ProviderModelCapabilities,
  PreflightResponse,
  EngineRunRecord,
  EngineStatusRecord,
  EngineAuthLoginResult,
  McpConfigStatus,
  McpSnippetValidationResult,
  McpServerSummary,
  ArtifactDiffResponse,
  ArtifactPreviewResponse,
  ArtifactRecord,
  FlowDraft,
  RunDebugResponse,
  SessionSummaryRecord,
  SkillTemplateRecord,
} from "../types";
import { apiRequest, buildHeaders, readJsonOrThrow } from "../apiClient";

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

export async function listChannels(signal?: AbortSignal) {
  return apiRequest<{ channels: ChannelSummary[] }>("/api/channels", { signal });
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

export async function listSkillTemplates(agentId?: string | null, signal?: AbortSignal) {
  const path = agentId ? `/api/skill-templates?agentId=${encodeURIComponent(agentId)}` : "/api/skill-templates";
  return apiRequest<{ templates: SkillTemplateRecord[]; boundary: string }>(path, {
    signal,
  });
}

export async function createCustomSkillTemplate(
  agentId: string,
  payload: Omit<SkillTemplateRecord, "id" | "createdAt" | "updatedAt" | "builtIn" | "agentId" | "scope"> & {
    scope?: "agent" | "shared";
  },
) {
  return apiRequest<{ template: SkillTemplateRecord; boundary: string }>(
    `/api/agents/${encodeURIComponent(agentId)}/skill-templates`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function updateCustomSkillTemplate(
  agentId: string,
  templateId: string,
  payload: Partial<
    Omit<SkillTemplateRecord, "createdAt" | "updatedAt" | "builtIn" | "agentId" | "scope"> & {
      scope: "agent" | "shared";
    }
  >,
) {
  return apiRequest<{ template: SkillTemplateRecord; boundary: string }>(
    `/api/agents/${encodeURIComponent(agentId)}/skill-templates/${encodeURIComponent(templateId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export async function deleteCustomSkillTemplate(agentId: string, templateId: string) {
  return apiRequest<{ ok: boolean; templateId: string; boundary: string }>(
    `/api/agents/${encodeURIComponent(agentId)}/skill-templates/${encodeURIComponent(templateId)}`,
    { method: "DELETE" },
  );
}

export async function applySkillTemplateToStandingOrders(agentId: string, templateId: string) {
  return apiRequest<{
    standingOrders: StandingOrdersRecord;
    template: SkillTemplateRecord;
    applied: boolean;
    message: string;
    boundary: string;
  }>(
    `/api/agents/${encodeURIComponent(agentId)}/skill-templates/${encodeURIComponent(
      templateId,
    )}/apply-standing-orders`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function applySkillTemplateToHeartbeat(agentId: string, templateId: string) {
  return apiRequest<{
    heartbeat: AgentHeartbeatRecord;
    template: SkillTemplateRecord;
    applied: boolean;
    message: string;
    boundary: string;
  }>(
    `/api/agents/${encodeURIComponent(agentId)}/skill-templates/${encodeURIComponent(
      templateId,
    )}/apply-heartbeat`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
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

export async function getPreflightStatus(
  payload: {
    agentId?: string | null;
    conversationId?: string | null;
  },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (payload.agentId) {
    params.set("agentId", payload.agentId);
  }
  if (payload.conversationId) {
    params.set("conversationId", payload.conversationId);
  }
  const query = params.toString();
  return apiRequest<PreflightResponse>(`/api/preflight${query ? `?${query}` : ""}`, { signal });
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

export async function getEngineRun(conversationId: string, runId: string, signal?: AbortSignal) {
  const searchParams = new URLSearchParams({ conversationId });
  return apiRequest<{ engineRun: EngineRunRecord }>(
    `/api/engine/runs/${encodeURIComponent(runId)}?${searchParams.toString()}`,
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

export async function previewArtifact(artifactId: string, signal?: AbortSignal) {
  return apiRequest<ArtifactPreviewResponse>(
    `/api/artifacts/${encodeURIComponent(artifactId)}/preview`,
    { signal },
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
