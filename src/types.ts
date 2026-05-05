export const providerKinds = [
  "openai",
  "anthropic",
  "gemini",
  "ollama",
  "openai-codex",
] as const;

export type ProviderKind = (typeof providerKinds)[number];

export type ChatRole = "user" | "assistant";
export type ReasoningLevel = "minimal" | "low" | "medium" | "high" | "xhigh";
export type ChannelKind = "webchat";
export type WorkspaceRunStatus = "running" | "completed" | "failed" | "cancelled";
export type TaskKind = "detached" | "heartbeat" | "continuation" | "scheduled" | "subagent" | "flow_step";
export type AgentEngineKind = "opencode";
export type EngineRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";
export type ToolPermission =
  | "workspace"
  | "memory"
  | "network"
  | "browser"
  | "exec"
  | "tasks";
export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled";
export type HeartbeatLogStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type HeartbeatTriggerSource = "manual" | "scheduler";

export interface AgentRecord {
  id: string;
  name: string;
  providerKind: ProviderKind;
  model: string;
  reasoningLevel: ReasoningLevel;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationRecord {
  id: string;
  agentId?: string;
  title: string;
  channelKind?: ChannelKind;
  sessionKind: string;
  parentConversationId: string | null;
  ownerRunId: string | null;
  providerKind: ProviderKind;
  model: string;
  reasoningLevel: ReasoningLevel;
  createdAt: number;
  updatedAt: number;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

export interface ProviderSummary {
  kind: ProviderKind;
  label: string;
  configured: boolean;
  status: "connected" | "configured" | "disconnected";
  displayName: string | null;
  email: string | null;
  accountId: string | null;
  metadata: Record<string, unknown>;
  capabilities?: ProviderModelCapabilities;
}

export interface ProviderModelCapabilities {
  streaming: boolean;
  nativeToolCalling: boolean;
  jsonMode: boolean;
  reasoningLevel: boolean;
  vision: boolean;
  maxContextTokens: number | null;
}

export interface ProviderDraft {
  apiKey: string;
  baseUrl: string;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  permission: ToolPermission;
  risk: string;
  costHint: string | null;
  concurrencyClass: string | null;
  batchable: boolean;
  rolePolicy: string | null;
  example?: string;
  audit?: {
    category: string;
    safeByDefault: boolean;
  };
}

export interface StandingOrdersRecord {
  path: string;
  content: string;
}

export interface TaskFlowRecord {
  id: string;
  agentId: string;
  conversationId: string | null;
  originRunId?: string | null;
  triggerSource?: string;
  title: string;
  status: string;
  resultSummary?: string | null;
  errorText?: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
}

export interface TaskFlowStepRecord {
  id: string;
  flowId: string;
  stepKey: string;
  title: string;
  prompt: string;
  dependencyStepKey: string | null;
  position: number;
  status: string | null;
  taskId: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
}

export interface TaskFlowStepTaskSummary {
  id: string;
  status: TaskStatus;
  runId: string | null;
  resultText: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface TaskFlowStepRunSummary {
  id: string;
  status: WorkspaceRunStatus;
  phase: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TaskFlowStepDetail extends TaskFlowStepRecord {
  task?: TaskFlowStepTaskSummary | null;
  run?: TaskFlowStepRunSummary | null;
}

export interface TaskFlowStepDraft {
  stepKey: string;
  title: string;
  prompt: string;
}

export interface PluginSkillSummary {
  name: string;
  summary?: string | null;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  tools: string[];
  skills: PluginSkillSummary[];
}

export interface AgentSkillSummary {
  id: string;
  name: string;
  source: "agent" | "shared" | "plugin";
  summary: string;
  pluginId: string | null;
}

export interface ChannelSummary {
  kind: ChannelKind | string;
  label: string;
  description?: string;
  enabled: boolean;
  note?: string | null;
}

export interface PlatformMetadata {
  plugins: PluginManifest[];
  tools: ToolDescriptor[];
  channels: ChannelSummary[];
  agentSkills?: AgentSkillSummary[];
}

export interface WorkspaceRunRecord {
  id: string;
  conversationId: string;
  taskId: string | null;
  parentRunId: string | null;
  phase: string | null;
  checkpoint: string | null;
  resumeToken: string | null;
  providerKind: ProviderKind;
  model: string;
  userMessage: string;
  status: WorkspaceRunStatus;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceRunEventRecord {
  id: string;
  runId: string;
  eventType:
    | "status"
    | "tool_call"
    | "tool_result"
    | "error"
    | "run_complete"
    | "run_failed"
    | "run_cancelled";
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface EngineRunRecord {
  runId: string;
  engineKind: AgentEngineKind;
  status: EngineRunStatus;
  externalSessionId: string | null;
  workspacePath: string | null;
  model: string;
  command: string | null;
  exitCode: number | null;
  eventSummary: Record<string, unknown>;
  startedAt: number;
  completedAt: number | null;
}

export interface EngineStatusRecord {
  engineKind: AgentEngineKind;
  configuredEngineKind: AgentEngineKind;
  available: boolean;
  installed: boolean;
  version: string | null;
  executable: string;
  executableSource?: "env" | "embedded-package" | "global" | "test-harness";
  managedPackageVersion?: string | null;
  configDir: string | null;
  authStatus: "available" | "unknown" | "unavailable";
  models: string[];
  sessions: Array<Record<string, unknown>>;
  lastFailure: string | null;
  environment: {
    autoUpdateDisabled: boolean;
    pruneDisabled: boolean;
    defaultPluginsDisabled: boolean;
    autoApprovePermissions: boolean;
  };
  credentialSync?: {
    mode: "runtime-env";
    configuredProviders: ProviderKind[];
    entries: Array<{
      providerKind: ProviderKind;
      opencodeProvider: string;
      authMode: "api_key" | "oauth" | "base_url";
      configured: boolean;
      runtimeEnvKeys: string[];
      note: string;
    }>;
  };
  opencodeAuthProviders?: string[];
}

export interface EngineAuthLoginResult {
  ok: boolean;
  launched: boolean;
  provider: string;
  command: string;
  message: string;
}

export interface TaskRecord {
  id: string;
  agentId: string;
  conversationId: string;
  runId: string | null;
  taskFlowId: string | null;
  flowStepKey: string | null;
  originRunId: string | null;
  automationRuleId: string | null;
  taskKind: TaskKind;
  parentTaskId: string | null;
  nestingDepth: number;
  title: string;
  prompt: string;
  providerKind: ProviderKind;
  model: string;
  reasoningLevel: ReasoningLevel;
  status: TaskStatus;
  resultText: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  scheduledFor: number | null;
  updatedAt: number;
}

export interface TaskEventRecord {
  id: string;
  taskId: string;
  eventType:
    | "queued"
    | "running"
    | "status"
    | "completed"
    | "failed"
    | "timed_out"
    | "cancelled"
    | "result_delivered";
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface AgentSoulRecord {
  path: string;
  content: string;
}

export interface AgentHeartbeatRecord {
  path: string;
  content: string;
  enabled: boolean;
  intervalMinutes: number;
  lastRun: string | null;
  instructions: string;
  parseError: string | null;
}

export interface HeartbeatLogRecord {
  id: string;
  agentId: string;
  conversationId: string;
  taskId: string | null;
  triggerSource: HeartbeatTriggerSource;
  status: HeartbeatLogStatus;
  summary: string | null;
  errorText: string | null;
  triggeredAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface AutomationRuleRecord {
  id: string;
  agentId: string;
  conversationId: string;
  title: string;
  prompt: string;
  providerKind: ProviderKind;
  model: string;
  reasoningLevel: ReasoningLevel;
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: number;
  lastRunAt: number | null;
  lastTaskId: string | null;
  runCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface StreamEventPayloadMap {
  status: { message: string; tool?: string };
  run_complete: { runId: string; changedFiles: string[]; engineRun?: EngineRunRecord };
  delta: { delta: string };
  done: { messageId: string | null; runId?: string; changedFiles?: string[] };
  error: { error: string; runId?: string; status?: WorkspaceRunStatus };
}

export interface DisplayMessage {
  id: string;
  role: ChatRole;
  content: string;
  pending?: boolean;
}

export const providerLabels: Record<ProviderKind, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  ollama: "Ollama",
  "openai-codex": "OpenAI Codex",
};

export const defaultModels: Record<ProviderKind, string> = {
  openai: "gpt-5.5",
  anthropic: "claude-opus-4-7",
  gemini: "gemini-3.1-pro-preview",
  ollama: "qwen3",
  "openai-codex": "gpt-5.5",
};

export const defaultReasoningLevels: Record<ProviderKind, ReasoningLevel> = {
  openai: "high",
  anthropic: "medium",
  gemini: "medium",
  ollama: "medium",
  "openai-codex": "high",
};
