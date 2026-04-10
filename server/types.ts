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
export type WorkspaceRunStatus = "running" | "completed" | "failed" | "cancelled";
export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled";
export type ToolPermission =
  | "workspace"
  | "memory"
  | "network"
  | "browser"
  | "exec"
  | "tasks";
export type ToolPermissionClass = "read" | "write" | "network" | "exec" | "memory" | "browser";

export interface ToolDescriptor {
  name: ToolName;
  description: string;
  permission: ToolPermissionClass;
  schema: Record<string, unknown>;
  audit: {
    category: string;
    safeByDefault: boolean;
  };
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  tools: ToolName[];
  skills: string[];
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

export interface TaskRecord {
  id: string;
  agentId: string;
  conversationId: string;
  runId: string | null;
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

export interface AgentMemorySnapshot {
  agentId: string;
  durableMemoryPath: string;
  durableMemory: string;
  dailyMemoryPath: string;
  dailyMemory: string;
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
