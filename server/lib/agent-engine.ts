import type {
  AgentRecord,
  AgentEngineKind,
  ChatMessage,
  ConversationRecord,
  EngineAuthLoginResult,
  EngineRunRecord,
  EngineStatusRecord,
  ProviderKind,
  ProviderSecret,
  ReasoningLevel,
  RunCheckpoint,
  SessionSummaryRecord,
  TaskStatus,
  WorkspaceRunPhase,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
  WorkspaceRunStatus,
} from "../types.js";

export type {
  AgentEngineKind,
  EngineAuthLoginResult,
  EngineRunRecord,
  EngineRunStatus,
} from "../types.js";

export type EngineStatus = EngineStatusRecord;

export interface EngineRefreshModelsResult {
  ok: boolean;
  models: string[];
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
  sessionSummary?: SessionSummaryRecord | null;
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
  getRunSummary: (conversationId: string, runId: string) => Promise<EngineRunRecord | null>;
}

export interface AgentEngineStore {
  createWorkspaceRun: (input: {
    conversationId: string;
    taskId?: string | null;
    parentRunId?: string | null;
    providerKind: ProviderKind;
    model: string;
    userMessage: string;
    phase?: Extract<WorkspaceRunPhase, "accepted" | "planning" | "tool_execution" | "synthesizing">;
    checkpoint?: RunCheckpoint | null;
    resumeToken?: string | null;
  }) => WorkspaceRunRecord;
  patchWorkspaceRun?: (input: {
    runId: string;
    taskId?: string | null;
    parentRunId?: string | null;
    phase?: WorkspaceRunPhase | null;
    checkpoint?: RunCheckpoint | null;
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
  getWorkspaceRunForConversation?: (conversationId: string, runId: string) => WorkspaceRunRecord | null;
  listWorkspaceRuns?: (conversationId: string) => WorkspaceRunRecord[];
  listWorkspaceRunEvents?: (conversationId: string, runId: string) => WorkspaceRunEventRecord[];
  createArtifactsForRun?: (input: {
    agentId: string;
    conversationId: string;
    runId: string;
    taskId?: string | null;
    changedFiles: string[];
  }) => unknown;
  getProviderSecret?: <K extends ProviderKind>(kind: K) => ProviderSecret<K> | null;
}

export class EngineRunError extends Error {
  status: Exclude<WorkspaceRunStatus, "running">;
  runId: string | null;
  taskStatus: Extract<TaskStatus, "failed" | "timed_out" | "cancelled"> | null;

  constructor(
    message: string,
    status: Exclude<WorkspaceRunStatus, "running">,
    runId?: string | null,
    taskStatus?: Extract<TaskStatus, "failed" | "timed_out" | "cancelled"> | null,
  ) {
    super(message);
    this.name = "EngineRunError";
    this.status = status;
    this.runId = runId ?? null;
    this.taskStatus = taskStatus ?? null;
  }
}

export function isEngineRunError(error: unknown): error is EngineRunError {
  return error instanceof EngineRunError;
}
