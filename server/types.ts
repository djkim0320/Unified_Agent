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
export type WorkspaceScope = "sandbox" | "shared" | "root";
export type ChannelKind = "webchat";
export type SessionKind = "primary" | "subagent";
export interface ChannelSummary {
  kind: ChannelKind;
  label: string;
  description: string;
  enabled: boolean;
  note: string | null;
}
export type WorkspaceRunStatus = "running" | "completed" | "failed" | "cancelled";
export type WorkspaceRunPhase =
  | "accepted"
  | "planning"
  | "tool_execution"
  | "synthesizing"
  | "completed"
  | "failed"
  | "cancelled";
export type TaskKind =
  | "detached"
  | "heartbeat"
  | "continuation"
  | "scheduled"
  | "subagent"
  | "flow_step";
export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled";
export type HeartbeatLogStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type HeartbeatTriggerSource = "manual" | "scheduler";
export type TaskFlowStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type TaskFlowStepStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";
export type TaskFlowTriggerSource = "manual" | "schedule" | "event_hook";
export type AgentEngineKind = "opencode";
export type EngineRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

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
  agentId: string;
  title: string;
  channelKind: ChannelKind;
  sessionKind: SessionKind;
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

export interface ProviderAccountRecord {
  providerKind: ProviderKind;
  displayName: string | null;
  email: string | null;
  accountId: string | null;
  status: "connected" | "configured" | "disconnected";
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderModelCapabilities {
  streaming: boolean;
  jsonMode: boolean;
  reasoningLevel: boolean;
  vision: boolean;
  maxContextTokens: number | null;
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

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface WorkspaceTreeNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number | null;
  children?: WorkspaceTreeNode[];
}

export interface WorkspaceFileRecord {
  scope: WorkspaceScope;
  path: string;
  content: string;
  binary: boolean;
  unsupportedEncoding: boolean;
  encoding: string | null;
}

export interface WorkspaceRunRecord {
  id: string;
  conversationId: string;
  taskId: string | null;
  parentRunId: string | null;
  providerKind: ProviderKind;
  model: string;
  userMessage: string;
  status: WorkspaceRunStatus;
  phase: WorkspaceRunPhase;
  checkpoint: RunCheckpoint | null;
  resumeToken: string | null;
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
  taskKind: TaskKind;
  taskFlowId: string | null;
  flowStepKey: string | null;
  originRunId: string | null;
  automationRuleId: string | null;
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

export interface AgentStandingOrdersRecord {
  path: string;
  content: string;
}

export interface RunCheckpoint {
  stepIndex: number;
  maxSteps: number;
  userMessage: string;
  toolHistory: Array<{ tool: string; result: string }>;
  changedFiles: string[];
  runMode: "foreground" | "detached" | "heartbeat" | "subagent";
  lastToolName: string | null;
}

export interface TaskFlowRecord {
  id: string;
  agentId: string;
  conversationId: string;
  originRunId: string | null;
  triggerSource: TaskFlowTriggerSource;
  title: string;
  status: TaskFlowStatus;
  resultSummary: string | null;
  errorText: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface TaskFlowStepRecord {
  id: string;
  flowId: string;
  taskId: string | null;
  stepKey: string;
  dependencyStepKey: string | null;
  position: number;
  title: string;
  prompt: string;
  status: TaskFlowStepStatus;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
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
  phase: WorkspaceRunPhase;
  createdAt: number;
  updatedAt: number;
}

export interface TaskFlowStepDetail extends TaskFlowStepRecord {
  task: TaskFlowStepTaskSummary | null;
  run: TaskFlowStepRunSummary | null;
}

export interface ProviderSecretMap {
  openai: {
    apiKey: string;
  };
  anthropic: {
    apiKey: string;
  };
  gemini: {
    apiKey: string;
  };
  ollama: {
    baseUrl: string;
  };
  "openai-codex": {
    accessToken: string;
    refreshToken: string;
    idToken?: string;
    expiresAt: number | null;
    chatgptAccountId: string | null;
    importedFromCli?: boolean;
    sourcePath?: string | null;
    lastRefresh?: string | null;
  };
}

export type ProviderSecret<K extends ProviderKind> = ProviderSecretMap[K];

export interface ProviderTestResult {
  ok: boolean;
  message: string;
}
