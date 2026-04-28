import type { createMemoryManager } from "./memory-manager.js";
import type { createPluginManager } from "./plugin-manager.js";
import type { createToolRegistry } from "./tool-registry.js";
import type {
  AgentRecord,
  ChatMessage,
  ConversationRecord,
  ProviderKind,
  ProviderSecret,
  ReasoningLevel,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
  WorkspaceRunStatus,
} from "../types.js";

export type AgentEngineKind = "opencode";

export type EngineRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

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

export interface EngineStatus {
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

export interface EngineRefreshModelsResult {
  ok: boolean;
  models: string[];
  message: string;
}

export interface EngineAuthLoginResult {
  ok: boolean;
  launched: boolean;
  provider: string;
  command: string;
  message: string;
}

export interface AgentEngineRunResult {
  runId: string;
  assistantText: string;
  changedFiles: string[];
  engineRun?: EngineRunRecord;
}

export interface AgentEngineRunParams {
  agent: AgentRecord;
  conversation: ConversationRecord;
  providerKind: ProviderKind;
  model: string;
  reasoningLevel: ReasoningLevel;
  conversationId: string;
  agentId: string;
  userMessage: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  unsafeShellEnabled?: boolean;
  isDetachedTask?: boolean;
  isHeartbeatRun?: boolean;
  isSubagentRun?: boolean;
  currentTaskId?: string | null;
  nestingDepth?: number;
  conversationTitle?: string;
  parentRunId?: string | null;
  sendEvent: (eventName: string, payload: Record<string, unknown>) => void;
}

export interface AgentEngine {
  kind: AgentEngineKind;
  runTurn: (params: AgentEngineRunParams) => Promise<AgentEngineRunResult>;
  getStatus: () => Promise<EngineStatus>;
  refreshModels: () => Promise<EngineRefreshModelsResult>;
  startAuthLogin: (params: {
    provider?: string;
    method?: string | null;
    launch?: boolean;
  }) => Promise<EngineAuthLoginResult>;
  getRunSummary: (runId: string) => Promise<EngineRunRecord | null>;
}

export interface AgentEngineStore {
  createWorkspaceRun: (input: {
    conversationId: string;
    taskId?: string | null;
    parentRunId?: string | null;
    providerKind: ProviderKind;
    model: string;
    userMessage: string;
    phase?: "accepted" | "planning" | "tool_execution" | "synthesizing";
    checkpoint?: {
      stepIndex: number;
      maxSteps: number;
      userMessage: string;
      toolHistory: Array<{ tool: string; result: string }>;
      changedFiles: string[];
      runMode: "foreground" | "detached" | "heartbeat" | "subagent";
      lastToolName: string | null;
    } | null;
    resumeToken?: string | null;
  }) => WorkspaceRunRecord;
  patchWorkspaceRun?: (input: {
    runId: string;
    taskId?: string | null;
    parentRunId?: string | null;
    phase?: "accepted" | "planning" | "tool_execution" | "synthesizing" | "completed" | "failed" | "cancelled" | null;
    checkpoint?: {
      stepIndex: number;
      maxSteps: number;
      userMessage: string;
      toolHistory: Array<{ tool: string; result: string }>;
      changedFiles: string[];
      runMode: "foreground" | "detached" | "heartbeat" | "subagent";
      lastToolName: string | null;
    } | null;
    resumeToken?: string | null;
  }) => unknown;
  appendWorkspaceRunEvent: (input: {
    runId: string;
    eventType: WorkspaceRunEventRecord["eventType"];
    payload: Record<string, unknown>;
  }) => WorkspaceRunEventRecord;
  finalizeWorkspaceRun: (
    id: string,
    status: Exclude<WorkspaceRunStatus, "running">,
    eventType: WorkspaceRunEventRecord["eventType"],
    payload: Record<string, unknown>,
  ) => { finalized: boolean; run: unknown };
  getWorkspaceRun?: (runId: string) => WorkspaceRunRecord | null;
  listWorkspaceRuns?: (conversationId: string) => WorkspaceRunRecord[];
  listWorkspaceRunEvents?: (conversationId: string, runId: string) => WorkspaceRunEventRecord[];
  getProviderSecret?: <K extends ProviderKind>(kind: K) => ProviderSecret<K> | null;
}

export interface EnginePromptServices {
  memoryManager?: ReturnType<typeof createMemoryManager>;
  pluginManager?: ReturnType<typeof createPluginManager>;
  toolRegistry?: ReturnType<typeof createToolRegistry>;
}

export class EngineRunError extends Error {
  status: Exclude<WorkspaceRunStatus, "running">;
  runId: string | null;

  constructor(message: string, status: Exclude<WorkspaceRunStatus, "running">, runId?: string | null) {
    super(message);
    this.name = "EngineRunError";
    this.status = status;
    this.runId = runId ?? null;
  }
}

export function isEngineRunError(error: unknown): error is EngineRunError {
  return error instanceof EngineRunError;
}
