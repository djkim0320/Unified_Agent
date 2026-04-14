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
export type ToolPermission =
  | "workspace"
  | "memory"
  | "network"
  | "browser"
  | "exec"
  | "tasks";
export type ToolPermissionClass = "read" | "write" | "network" | "exec" | "memory" | "browser";
export type ToolRiskLevel = "low" | "medium" | "high";
export type ToolCostHint = "cheap" | "moderate" | "expensive";
export type ToolConcurrencyClass = "serial" | "parallel-safe" | "exclusive";

export interface ToolDescriptor {
  name: ToolName;
  description: string;
  permission: ToolPermissionClass;
  schema: Record<string, unknown>;
  risk?: ToolRiskLevel;
  costHint?: ToolCostHint;
  concurrencyClass?: ToolConcurrencyClass;
  batchable?: boolean;
  rolePolicy?: {
    allowPrimary?: boolean;
    allowSubagent?: boolean;
    maxNestingDepth?: number | null;
  };
  audit: {
    category: string;
    safeByDefault: boolean;
  };
}

export interface ToolSummary {
  name: string;
  description: string;
  permission: ToolPermission;
  risk?: ToolRiskLevel;
  costHint?: ToolCostHint;
  concurrencyClass?: ToolConcurrencyClass;
  batchable?: boolean;
  rolePolicy?: {
    allowPrimary?: boolean;
    allowSubagent?: boolean;
    maxNestingDepth?: number | null;
  };
  audit: {
    category: string;
    safeByDefault: boolean;
  };
}

export interface PluginSkillSummary {
  name: string;
  summary: string | null;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  tools: ToolName[];
  skills: PluginSkillSummary[];
}

export interface AgentSkillSummary {
  id: string;
  name: string;
  source: "agent" | "shared" | "plugin";
  summary: string;
  pluginId: string | null;
}

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

export interface ProviderSummary {
  kind: ProviderKind;
  label: string;
  configured: boolean;
  status: "connected" | "configured" | "disconnected";
  displayName: string | null;
  email: string | null;
  accountId: string | null;
  metadata: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface SearchBackendAvailability {
  kind: "provider_web_search" | "duckduckgo_search" | "browser_search" | "web_fetch";
  enabled: boolean;
  label: string;
  note: string | null;
}

export interface ExecToolArguments {
  program: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
}

export type ToolName = string;

export interface ToolCall {
  name: ToolName;
  arguments: Record<string, unknown>;
}

export interface AgentToolStep {
  type: "tool_call";
  tool: ToolCall;
}

export interface AgentFinalStep {
  type: "final_answer";
}

export type AgentStep = AgentToolStep | AgentFinalStep;

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

export interface TaskRecord {
  id: string;
  agentId: string;
  conversationId: string;
  runId: string | null;
  taskKind: TaskKind;
  taskFlowId: string | null;
  flowStepKey: string | null;
  originRunId: string | null;
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

export interface AgentStandingOrdersRecord {
  path: string;
  content: string;
}

export interface AgentMemorySnapshot {
  agentId: string;
  durableMemoryPath: string;
  durableMemory: string;
  dailyMemoryPath: string;
  dailyMemory: string;
}

export interface MemorySearchResult {
  path: string;
  line: number;
  text: string;
  kind: "durable" | "daily" | "session_summary" | "outcome";
  score: number;
  reason: string;
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
  title: string;
  prompt: string;
  status: TaskFlowStepStatus;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
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
    expiresAt: number | null;
    chatgptAccountId: string | null;
    importedFromCli?: boolean;
  };
}

export type ProviderSecret<K extends ProviderKind> = ProviderSecretMap[K];

export interface StreamCallbacks {
  onText: (chunk: string) => void;
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
}

export interface ProviderAdapterContext<K extends ProviderKind> {
  secret: ProviderSecret<K>;
  fetchImpl: typeof fetch;
}

export interface PlanningPrompt {
  instructions: string;
  messages: ChatMessage[];
}
