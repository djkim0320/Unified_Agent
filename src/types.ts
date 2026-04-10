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
}

export interface ProviderDraft {
  apiKey: string;
  baseUrl: string;
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
  taskId?: string | null;
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

export type AgentMemoryRecord = AgentMemorySnapshot;

export interface StreamEventPayloadMap {
  status: { message: string; tool?: string };
  tool_call: { tool: string; arguments: Record<string, unknown> };
  tool_result: { tool: string; result: Record<string, unknown> };
  run_complete: { runId: string; changedFiles: string[] };
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
  openai: "gpt-5.4",
  anthropic: "claude-sonnet-4-6",
  gemini: "gemini-3-flash-preview",
  ollama: "qwen3",
  "openai-codex": "gpt-5.4",
};

export const defaultReasoningLevels: Record<ProviderKind, ReasoningLevel> = {
  openai: "high",
  anthropic: "medium",
  gemini: "medium",
  ollama: "medium",
  "openai-codex": "high",
};
