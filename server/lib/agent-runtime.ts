import { ZodError, z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { searchDuckDuckGo } from "./duckduckgo.js";
import { runWorkspaceCommand } from "./exec-command.js";
import type { createMemoryManager } from "./memory-manager.js";
import type { createPluginManager } from "./plugin-manager.js";
import type { createToolRegistry } from "./tool-registry.js";
import { fetchWebPage } from "./web-fetch.js";
import { createAbortError, isAbortError } from "./process-control.js";
import type { createBrowserRuntime } from "./browser-runtime.js";
import type { createWorkspaceManager } from "./workspace.js";
import type { ProviderAdapter } from "../providers/base.js";
import type {
  AgentRecord,
  AgentStep,
  ChatMessage,
  ConversationRecord,
  ProviderKind,
  ProviderSecret,
  ReasoningLevel,
  SearchBackendAvailability,
  TaskFlowRecord,
  TaskFlowStepRecord,
  TaskKind,
  ToolCall,
  ToolName,
  WorkspaceRunEventRecord,
  WorkspaceRunStatus,
  WorkspaceScope,
} from "../types.js";

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_AUTONOMOUS_MAX_STEPS = 30;
const DEFAULT_RUN_TIMEOUT_MS = 120_000;
const DEFAULT_AUTONOMOUS_RUN_TIMEOUT_MS = 600_000;
const DEFAULT_SOUL_GUIDANCE = [
  "SOUL guidance:",
  "- Be autonomous, but never override safety, tool, or workspace boundary rules.",
  "- Prefer completing the user's current goal with the fewest safe steps.",
  "- When a detached or heartbeat run reaches its autonomous step limit, queue a continuation instead of failing outright.",
  "- Keep follow-up work focused, concise, and grounded in the visible workspace state.",
].join("\n");

const ScopeSchema = z.enum(["sandbox", "shared", "root"]).default("sandbox");

const ToolArgumentSchemas: Record<ToolName, z.ZodType<Record<string, unknown>>> = {
  list_tree: z.object({
    scope: ScopeSchema.optional(),
    path: z.string().optional(),
    maxDepth: z.number().int().min(0).max(8).optional(),
  }),
  read_file: z.object({
    scope: ScopeSchema.optional(),
    path: z.string().min(1),
  }),
  write_file: z.object({
    scope: ScopeSchema.optional(),
    path: z.string().min(1),
    content: z.string(),
  }),
  edit_file: z.object({
    scope: ScopeSchema.optional(),
    path: z.string().min(1),
    find: z.string().min(1),
    replace: z.string(),
    replaceAll: z.boolean().optional(),
  }),
  make_dir: z.object({
    scope: ScopeSchema.optional(),
    path: z.string().min(1),
  }),
  move_path: z.object({
    scope: ScopeSchema.optional(),
    from: z.string().min(1),
    to: z.string().min(1),
  }),
  delete_path: z.object({
    scope: ScopeSchema.optional(),
    path: z.string().min(1),
    recursive: z.boolean().optional(),
  }),
  exec_command: z.object({
    program: z.string().min(1),
    args: z.array(z.string()).optional(),
    cwd: z.string().min(1).optional(),
    timeoutMs: z.number().int().min(1).max(120_000).optional(),
  }),
  provider_web_search: z.object({
    query: z.string().min(1),
  }),
  duckduckgo_search: z.object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(10).optional(),
  }),
  web_fetch: z.object({
    url: z.string().url(),
  }),
  browser_search: z.object({
    query: z.string().min(1),
  }),
  browser_open: z.object({
    url: z.string().url(),
  }),
  browser_snapshot: z.object({}),
  browser_extract: z.object({
    selector: z.string().optional(),
  }),
  browser_click: z.object({
    selector: z.string().min(1),
  }),
  browser_type: z.object({
    selector: z.string().min(1),
    text: z.string(),
    submit: z.boolean().optional(),
  }),
  browser_back: z.object({}),
  browser_close: z.object({}),
  memory_get: z.object({}),
  memory_search: z.object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(20).optional(),
  }),
  memory_write: z.object({
    content: z.string().min(1),
    target: z.enum(["durable", "daily"]).optional(),
  }),
  spawn_subagent_session: z.object({
    prompt: z.string().min(1),
    title: z.string().min(1).optional(),
    providerKind: z.enum(["openai", "anthropic", "gemini", "ollama", "openai-codex"]).optional(),
    model: z.string().min(1).optional(),
    reasoningLevel: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
  }),
  spawn_task: z.object({
    prompt: z.string().min(1),
    title: z.string().min(1).optional(),
  }),
  schedule_task: z.object({
    prompt: z.string().min(1),
    title: z.string().min(1).optional(),
      delayMs: z.number().int().min(1).max(7 * 24 * 60 * 60 * 1000).optional(),
      scheduledFor: z.number().int().min(0).optional(),
    }),
  create_task_flow: z.object({
    title: z.string().min(1),
    steps: z
      .array(
        z.object({
          stepKey: z.string().min(1),
          title: z.string().min(1),
          prompt: z.string().min(1),
          dependencyStepKey: z.string().min(1).optional(),
        }),
      )
      .min(1)
      .max(8),
  }),
};

export class AgentRunError extends Error {
  status: Exclude<WorkspaceRunStatus, "running">;
  runId: string | null;

  constructor(message: string, status: Exclude<WorkspaceRunStatus, "running">, runId?: string) {
    super(message);
    this.name = "AgentRunError";
    this.status = status;
    this.runId = runId ?? null;
  }
}

function clipText(text: string, maxLength = 4000) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function localizedToolStatusLabel(toolName: ToolName) {
  if (toolName.startsWith("memory_")) {
    return "\uBA54\uBAA8\uB9AC \uC791\uC5C5 \uC911";
  }
  if (toolName.includes("search")) {
    return "\uAC80\uC0C9 \uC911";
  }
  if (toolName.startsWith("browser_")) {
    return "\uBE0C\uB77C\uC6B0\uC800 \uC870\uC0AC \uC911";
  }
  if (toolName === "exec_command") {
    return "\uBA85\uB839 \uC2E4\uD589 \uC911";
  }
  return "\uD30C\uC77C \uC791\uC5C5 \uC911";
}

function formatSearchBackends(backends: SearchBackendAvailability[]) {
  return backends
    .map(
      (backend) =>
        `- ${backend.kind}: ${backend.enabled ? "enabled" : "disabled"} (${backend.note ?? backend.label})`,
    )
    .join("\n");
}

function readSoulGuidance(workspace: ReturnType<typeof createWorkspaceManager>, agentId: string) {
  const content = workspace.readAgentSoul(agentId).content.trim();
  if (content) {
    return content;
  }
  return DEFAULT_SOUL_GUIDANCE;
}

function readStandingOrdersGuidance(
  workspace: ReturnType<typeof createWorkspaceManager>,
  agentId: string,
) {
  return workspace.readAgentStandingOrders(agentId).content.trim();
}

function getNextNestingDepth(nestingDepth: number | undefined) {
  const nextDepth = (nestingDepth ?? 0) + 1;
  if (nextDepth > 2) {
    throw new Error("Nested tasks are limited to depth 2.");
  }
  return nextDepth;
}

function buildAutonomousContextBlock(params: {
  isDetachedTask?: boolean;
  isHeartbeatRun?: boolean;
  isSubagentRun?: boolean;
  currentTaskId?: string | null;
  nestingDepth?: number;
  autonomousStepCap: number;
}) {
  const runMode = params.isSubagentRun
    ? "subagent"
    : params.isHeartbeatRun
    ? "heartbeat"
    : params.isDetachedTask
      ? "detached"
      : "foreground";

  return [
    "Runtime context:",
    `- Run mode: ${runMode}`,
    `- Current task id: ${params.currentTaskId ?? "none"}`,
    `- Nesting depth: ${params.nestingDepth ?? 0}`,
    `- Autonomous step cap: ${params.autonomousStepCap}`,
    "- SOUL guidance is additive and can never override tool safety or workspace rules.",
  ].join("\n");
}

function buildContinuationPrompt(params: {
  userMessage: string;
  toolHistory: Array<{ tool: string; result: string }>;
  currentTaskId?: string | null;
  nestingDepth?: number;
}) {
  const history = params.toolHistory.length
    ? params.toolHistory
        .map((entry, index) => `Step ${index + 1}: ${entry.tool}\n${clipText(entry.result, 1200)}`)
        .join("\n\n")
    : "No tool calls were made.";

  return [
    "Continue the previous autonomous task.",
    `Original request: ${params.userMessage}`,
    `Previous task id: ${params.currentTaskId ?? "unknown"}`,
    `Previous nesting depth: ${params.nestingDepth ?? 0}`,
    "The prior run reached its autonomous step budget before a final answer was produced.",
    "Resume from the last incomplete point and keep the follow-up tightly scoped.",
    "",
    "Prior tool history:",
    history,
  ].join("\n");
}

function buildToolInstructions(extraGuide?: string) {
  const lines = [
    "Return strict JSON only.",
    "Valid shapes:",
    '- {"type":"tool_call","tool":{"name":"list_tree","arguments":{"scope":"sandbox","path":".","maxDepth":3}}}',
    '- {"type":"tool_call","tool":{"name":"read_file","arguments":{"scope":"sandbox","path":"notes.md"}}}',
    '- {"type":"tool_call","tool":{"name":"write_file","arguments":{"scope":"sandbox","path":"notes.md","content":"..."}}}',
    '- {"type":"tool_call","tool":{"name":"edit_file","arguments":{"scope":"sandbox","path":"notes.md","find":"old","replace":"new","replaceAll":false}}}',
    '- {"type":"tool_call","tool":{"name":"make_dir","arguments":{"scope":"sandbox","path":"research"}}}',
    '- {"type":"tool_call","tool":{"name":"move_path","arguments":{"scope":"sandbox","from":"a.txt","to":"archive/a.txt"}}}',
    '- {"type":"tool_call","tool":{"name":"delete_path","arguments":{"scope":"sandbox","path":"tmp","recursive":true}}}',
    '- {"type":"tool_call","tool":{"name":"exec_command","arguments":{"program":"node","args":["--version"],"cwd":".","timeoutMs":10000}}}',
    '- {"type":"tool_call","tool":{"name":"provider_web_search","arguments":{"query":"..."}}}',
    '- {"type":"tool_call","tool":{"name":"duckduckgo_search","arguments":{"query":"...","maxResults":5}}}',
    '- {"type":"tool_call","tool":{"name":"web_fetch","arguments":{"url":"https://example.com"}}}',
    '- {"type":"tool_call","tool":{"name":"browser_search","arguments":{"query":"..."}}}',
    '- {"type":"tool_call","tool":{"name":"browser_open","arguments":{"url":"https://example.com"}}}',
    '- {"type":"tool_call","tool":{"name":"browser_snapshot","arguments":{}}}',
    '- {"type":"tool_call","tool":{"name":"browser_extract","arguments":{"selector":"main"}}}',
    '- {"type":"tool_call","tool":{"name":"browser_click","arguments":{"selector":"button"}}}',
    '- {"type":"tool_call","tool":{"name":"browser_type","arguments":{"selector":"input[name=q]","text":"query","submit":true}}}',
    '- {"type":"tool_call","tool":{"name":"browser_back","arguments":{}}}',
    '- {"type":"tool_call","tool":{"name":"browser_close","arguments":{}}}',
    '- {"type":"tool_call","tool":{"name":"memory_get","arguments":{}}}',
    '- {"type":"tool_call","tool":{"name":"memory_search","arguments":{"query":"preference","maxResults":5}}}',
    '- {"type":"tool_call","tool":{"name":"memory_write","arguments":{"content":"User prefers concise Korean summaries.","target":"durable"}}}',
    '- {"type":"tool_call","tool":{"name":"spawn_subagent_session","arguments":{"title":"Investigate tests","prompt":"Inspect the failing test files and summarize the root cause."}}}',
    '- {"type":"tool_call","tool":{"name":"spawn_task","arguments":{"title":"Research follow-up","prompt":"Research the current repository state and summarize next steps."}}}',
    '- {"type":"tool_call","tool":{"name":"schedule_task","arguments":{"title":"Later follow-up","prompt":"Check back after the current run finishes.","delayMs":600000}}}',
    '- {"type":"tool_call","tool":{"name":"create_task_flow","arguments":{"title":"Ship patch","steps":[{"stepKey":"inspect","title":"Inspect repo","prompt":"Inspect the current code paths."},{"stepKey":"implement","title":"Implement fix","prompt":"Make the required code changes.","dependencyStepKey":"inspect"}]}}}',
    '- {"type":"final_answer"}',
    "Use only one tool per step.",
    "Do not invent tool results.",
    "Use exec_command only with a direct program plus args. Shells such as PowerShell/cmd/bash are disabled unless the user explicitly enables unsafe mode.",
    "Use memory_write only for durable preferences, decisions, and facts the user explicitly asks you to remember or that are clearly reusable later.",
    "Prefer provider_web_search or duckduckgo_search for ordinary search, web_fetch for a direct URL, and browser tools for pages that need rendering or interaction.",
  ];

  if (extraGuide?.trim()) {
    lines.push("", "Registered tools:", extraGuide.trim());
  }

  return lines.join("\n");
}

function buildPlanningInstructions(params: {
  guides: { agents: string; memory: string; user: string; tools: string };
  stepIndex: number;
  maxSteps: number;
  searchBackends: SearchBackendAvailability[];
  toolHistory: Array<{ tool: string; result: string }>;
  soulBlock: string;
  standingOrdersBlock?: string;
  runtimeContext: string;
  memoryBlock?: string;
  skillsBlock?: string;
  toolGuide?: string;
  repairHint?: string;
}) {
  const historyBlock = params.toolHistory.length
    ? params.toolHistory
        .map(
          (entry, index) =>
            `Step ${index + 1} - ${entry.tool}\n${clipText(entry.result, 2500)}`,
        )
        .join("\n\n")
    : "No tool calls have been made yet.";

  return [
    "You are an autonomous workspace agent inside a local multi-provider chat app.",
    "The server will execute tools on your behalf.",
    "Stop and return final_answer when you have enough information to answer the user well.",
    params.repairHint ? `Previous response problem: ${params.repairHint}` : "",
    "",
    `Current planning step: ${params.stepIndex + 1} / ${params.maxSteps}`,
    "Workspace scope: use sandbox for conversation files and shared for intentionally shared files.",
    "",
    params.runtimeContext,
    "",
    "Available search backends:",
    formatSearchBackends(params.searchBackends),
    "",
    "Workspace guides:",
    params.guides.agents,
    "",
    params.guides.memory,
    "",
    params.memoryBlock ? "Agent memory:" : "",
    params.memoryBlock ?? "",
    "",
    params.guides.user,
    "",
    params.guides.tools,
    "",
    params.skillsBlock ? "Loaded skills:" : "",
    params.skillsBlock ?? "",
    "",
    params.standingOrdersBlock ? "Standing orders:" : "",
    params.standingOrdersBlock ?? "",
    "",
    params.soulBlock ? "SOUL guidance:" : "",
    params.soulBlock ?? "",
    "",
    "Previous tool results:",
    historyBlock,
    "",
    buildToolInstructions(params.toolGuide),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFinalInstructions(params: {
  guides: { agents: string; memory: string; user: string; tools: string };
  toolHistory: Array<{ tool: string; result: string }>;
  changedFiles: string[];
  soulBlock: string;
  standingOrdersBlock?: string;
  runtimeContext: string;
  continuationNote?: string;
}) {
  const changes = params.changedFiles.length
    ? params.changedFiles.map((file) => `- ${file}`).join("\n")
    : "- No workspace files changed.";
  const history = params.toolHistory.length
    ? params.toolHistory
        .map((entry, index) => `Step ${index + 1}: ${entry.tool}\n${clipText(entry.result, 1400)}`)
        .join("\n\n")
    : "No tools were used.";

  return [
    "You are the assistant in a local autonomous workspace chat app.",
    "Answer in the user's language.",
    "Summarize the work performed and the outcome.",
    "If files changed, mention them briefly.",
    "Do not claim actions that were not performed.",
    params.continuationNote ? params.continuationNote : "",
    "",
    params.runtimeContext,
    "",
    params.guides.agents,
    "",
    params.standingOrdersBlock ? "Standing orders:" : "",
    params.standingOrdersBlock ?? "",
    "",
    params.soulBlock ? "SOUL guidance:" : "",
    params.soulBlock ?? "",
    "",
    "Tool history:",
    history,
    "",
    "Changed files:",
    changes,
  ].join("\n");
}

function buildToolSummary(toolCall: ToolCall, result: Record<string, unknown>) {
  return JSON.stringify(
    {
      tool: toolCall.name,
      arguments: toolCall.arguments,
      result,
    },
    null,
    2,
  );
}

function combineRunSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(createAbortError(`Agent run timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  const abortListener = () => {
    controller.abort(signal?.reason ?? createAbortError());
  };

  if (signal?.aborted) {
    controller.abort(signal.reason ?? createAbortError());
  } else {
    signal?.addEventListener("abort", abortListener, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortListener);
    },
  };
}

function validationMessage(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : "Tool argument validation failed.";
}

async function planStepWithRecovery<K extends ProviderKind>(params: {
  adapter: ProviderAdapter<K>;
  secret: ProviderSecret<K>;
  model: string;
  reasoningLevel: ReasoningLevel;
  instructions: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  onRepair?: (error: Error) => void;
}) {
  try {
    return await params.adapter.planToolStep({
      secret: params.secret,
      model: params.model,
      reasoningLevel: params.reasoningLevel,
      instructions: params.instructions,
      messages: params.messages,
      signal: params.signal,
    });
  } catch (firstError) {
    if (params.signal.aborted || isAbortError(firstError)) {
      throw firstError;
    }

    params.onRepair?.(
      firstError instanceof Error
        ? firstError
        : new Error("Planner returned invalid JSON."),
    );

    const repairedInstructions = `${params.instructions}

Your previous planner response was invalid or did not match the tool schema:
${firstError instanceof Error ? firstError.message : "Invalid planner response."}

Return exactly one valid JSON object now. No markdown, no prose.`;

    return await params.adapter.planToolStep({
      secret: params.secret,
      model: params.model,
      reasoningLevel: params.reasoningLevel,
      instructions: repairedInstructions,
      messages: params.messages,
      signal: params.signal,
    });
  }
}

export async function runAgentTurn<K extends ProviderKind>(params: {
  agent?: AgentRecord;
  adapter: ProviderAdapter<K>;
  secret: ProviderSecret<K>;
  providerKind: ProviderKind;
  model: string;
  reasoningLevel: ReasoningLevel;
  conversationId: string;
  agentId?: string;
  userMessage: string;
  messages: ChatMessage[];
  workspace: ReturnType<typeof createWorkspaceManager>;
  browserRuntime: ReturnType<typeof createBrowserRuntime>;
  memoryManager?: ReturnType<typeof createMemoryManager>;
  pluginManager?: ReturnType<typeof createPluginManager>;
  toolRegistry?: ReturnType<typeof createToolRegistry>;
  taskManager?: {
    enqueueDetachedTask: (input: {
      agentId: string;
      conversationId: string;
      prompt: string;
      title?: string;
      providerKind: ProviderKind;
      model: string;
      reasoningLevel: ReasoningLevel;
      taskKind?: TaskKind;
      parentTaskId?: string | null;
      nestingDepth?: number;
      scheduledFor?: number | null;
      startImmediately?: boolean;
      taskFlowId?: string | null;
      flowStepKey?: string | null;
      originRunId?: string | null;
    }) => Promise<{ id: string }>;
  };
  sessionManager?: {
    spawnSubagentSession: (input: {
      agentId: string;
      parentConversationId: string;
      parentRunId: string;
      prompt: string;
      title?: string;
      providerKind: ProviderKind;
      model: string;
      reasoningLevel: ReasoningLevel;
    }) => Promise<{
      session: ConversationRecord;
      task: { id: string };
    }>;
  };
  flowManager?: {
    createFlow: (input: {
      agentId: string;
      conversationId: string;
      title: string;
      originRunId?: string | null;
      steps: Array<{
        stepKey: string;
        title: string;
        prompt: string;
        dependencyStepKey?: string | null;
      }>;
    }) => Promise<{
      flow: TaskFlowRecord;
      steps: TaskFlowStepRecord[];
    }>;
  };
  store: {
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
    }) => { id: string };
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
  };
  sendEvent: (eventName: string, payload: Record<string, unknown>) => void;
  signal?: AbortSignal;
  maxSteps?: number;
  runTimeoutMs?: number;
  unsafeShellEnabled?: boolean;
  isDetachedTask?: boolean;
  isHeartbeatRun?: boolean;
  isSubagentRun?: boolean;
  currentTaskId?: string | null;
  nestingDepth?: number;
  conversationTitle?: string;
  parentRunId?: string | null;
}) {
  const runMode: "foreground" | "detached" | "heartbeat" | "subagent" = params.isSubagentRun
    ? "subagent"
    : params.isHeartbeatRun
      ? "heartbeat"
      : params.isDetachedTask
        ? "detached"
        : "foreground";
  const makeCheckpoint = (
    stepIndex: number,
    maxSteps: number,
    toolHistory: Array<{ tool: string; result: string }>,
    changedFiles: Iterable<string>,
    lastToolName: string | null,
  ) => ({
    stepIndex,
    maxSteps,
    userMessage: params.userMessage,
    toolHistory: toolHistory.map((entry) => ({ ...entry })),
    changedFiles: [...changedFiles],
    runMode,
    lastToolName,
  });
  const run = params.store.createWorkspaceRun({
    conversationId: params.conversationId,
    taskId: params.currentTaskId ?? null,
    parentRunId: params.parentRunId ?? null,
    providerKind: params.providerKind,
    model: params.model,
    userMessage: params.userMessage,
    phase: "accepted",
    checkpoint: makeCheckpoint(0, params.maxSteps ?? (params.isDetachedTask || params.isHeartbeatRun || params.isSubagentRun ? DEFAULT_AUTONOMOUS_MAX_STEPS : DEFAULT_MAX_STEPS), [], [], null),
    resumeToken: null,
  });
  const isAutonomousRun = Boolean(params.isDetachedTask || params.isHeartbeatRun || params.isSubagentRun);
  const runSignal = combineRunSignal(
    params.signal,
    params.runTimeoutMs ?? (isAutonomousRun ? DEFAULT_AUTONOMOUS_RUN_TIMEOUT_MS : DEFAULT_RUN_TIMEOUT_MS),
  );
  const guides = params.workspace.readGuides();
  const agentId = params.agentId ?? "default-agent";
  const soulBlock = readSoulGuidance(params.workspace, agentId);
  const standingOrdersBlock = readStandingOrdersGuidance(params.workspace, agentId);
  params.workspace.createAgentWorkspace(agentId);
  params.workspace.createConversationWorkspace(params.conversationId);
  const memoryContext = params.memoryManager?.getPlanningContext({
    agentId,
    userMessage: params.userMessage,
    messages: params.messages,
  });
  const skillBlock = params.agent && params.pluginManager
    ? params.pluginManager.getPlanningSkillBlock(params.agent)
    : null;
  const searchBackends: SearchBackendAvailability[] = [
    {
      kind: "provider_web_search",
      enabled: Boolean(params.adapter.searchWeb),
      label: `${params.adapter.label} web search`,
      note: params.adapter.searchWeb ? null : "Current provider does not expose native web search.",
    },
    {
      kind: "duckduckgo_search",
      enabled: true,
      label: "DuckDuckGo HTML search",
      note: "Key-free fallback search backend.",
    },
    {
      kind: "browser_search",
      enabled: true,
      label: "Chromium browser research",
      note: "Use for rendered or interactive pages.",
    },
    {
      kind: "web_fetch",
      enabled: true,
      label: "Direct URL fetch",
      note: "Use for a known article URL.",
    },
  ];

  const stepCap = isAutonomousRun ? DEFAULT_AUTONOMOUS_MAX_STEPS : DEFAULT_MAX_STEPS;
  const requestedMaxSteps = params.maxSteps ?? stepCap;
  const maxSteps = Math.min(requestedMaxSteps, stepCap);
  const toolHistory: Array<{ tool: string; result: string }> = [];
  const changedFiles = new Set<string>();
  let terminalState: Exclude<WorkspaceRunStatus, "running"> | null = null;
  let failureEventRecorded = false;
  const runtimeContext = buildAutonomousContextBlock({
    isDetachedTask: params.isDetachedTask,
    isHeartbeatRun: params.isHeartbeatRun,
    isSubagentRun: params.isSubagentRun,
    currentTaskId: params.currentTaskId,
    nestingDepth: params.nestingDepth,
    autonomousStepCap: stepCap,
  });
  const patchRun = (input: {
    phase?: "accepted" | "planning" | "tool_execution" | "synthesizing" | "completed" | "failed" | "cancelled" | null;
    checkpoint?: ReturnType<typeof makeCheckpoint> | null;
    taskId?: string | null;
    parentRunId?: string | null;
    resumeToken?: string | null;
  }) => {
    params.store.patchWorkspaceRun?.({
      runId: run.id,
      taskId: input.taskId ?? params.currentTaskId ?? null,
      parentRunId: input.parentRunId ?? params.parentRunId ?? null,
      phase: input.phase ?? null,
      checkpoint: input.checkpoint ?? null,
      resumeToken: input.resumeToken ?? null,
    });
  };

  const emit = (eventType: WorkspaceRunEventRecord["eventType"], payload: Record<string, unknown>) => {
    params.store.appendWorkspaceRunEvent({
      runId: run.id,
      eventType,
      payload,
    });
  };

  const finalize = (
    status: Exclude<WorkspaceRunStatus, "running">,
    eventType: WorkspaceRunEventRecord["eventType"],
    payload: Record<string, unknown>,
  ) => {
    if (terminalState) {
      return;
    }
    terminalState = status;
    params.store.finalizeWorkspaceRun(run.id, status, eventType, payload);
  };

  try {
    let reachedFinalStep = false;

    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
      if (runSignal.signal.aborted) {
        throw runSignal.signal.reason ?? createAbortError();
      }

      patchRun({
        phase: "planning",
        checkpoint: makeCheckpoint(stepIndex, maxSteps, toolHistory, changedFiles, null),
      });
      const instructions = buildPlanningInstructions({
        guides,
        stepIndex,
        maxSteps,
        searchBackends,
        toolHistory,
        soulBlock,
        standingOrdersBlock,
        runtimeContext,
        memoryBlock: memoryContext?.promptBlock,
        skillsBlock: skillBlock ?? undefined,
        toolGuide: params.toolRegistry?.buildPlannerGuide({
          isSubagent: params.isSubagentRun,
          nestingDepth: params.nestingDepth ?? 0,
        }),
      });

      let step: AgentStep;
      try {
        step = await planStepWithRecovery({
          adapter: params.adapter,
          secret: params.secret,
          model: params.model,
          reasoningLevel: params.reasoningLevel,
          instructions,
          messages: params.messages,
          signal: runSignal.signal,
          onRepair: (error) => {
            const payload = {
              message: "Planner response was invalid. Retrying with strict JSON.",
              phase: "planning_repair",
              reason: error.message,
            };
            emit("status", payload);
            params.sendEvent("status", {
              ...payload,
              runId: run.id,
            });
          },
        });
      } catch (error) {
        if (toolHistory.length > 0 && !runSignal.signal.aborted && !isAbortError(error)) {
          const payload = {
            message:
              "Planner response stayed invalid after tool execution. Falling back to final answer synthesis.",
            phase: "planning_fallback_final",
            reason: error instanceof Error ? error.message : "Invalid planner response.",
          };
          emit("status", payload);
          params.sendEvent("status", {
            ...payload,
            runId: run.id,
          });
          reachedFinalStep = true;
          break;
        }

        const message = error instanceof Error ? error.message : "Planner returned invalid JSON.";
        emit("error", { error: message, phase: "planning" });
        failureEventRecorded = true;
        throw new AgentRunError(message, isAbortError(error) ? "cancelled" : "failed", run.id);
      }

      if (step.type === "final_answer") {
        reachedFinalStep = true;
        break;
      }

      const status = localizedToolStatusLabel(step.tool.name);
      emit("status", { message: status, tool: step.tool.name });
      params.sendEvent("status", { message: status, tool: step.tool.name, runId: run.id });
      emit("tool_call", {
        tool: step.tool.name,
        arguments: step.tool.arguments,
      });
      params.sendEvent("tool_call", {
        tool: step.tool.name,
        arguments: step.tool.arguments,
        runId: run.id,
      });
      patchRun({
        phase: "tool_execution",
        checkpoint: makeCheckpoint(stepIndex, maxSteps, toolHistory, changedFiles, step.tool.name),
      });

      let result: Record<string, unknown>;
      try {
        result = params.toolRegistry
          ? await params.toolRegistry.execute(step.tool, {
              agentId,
              conversationId: params.conversationId,
              runId: run.id,
              workspace: params.workspace,
              browserRuntime: params.browserRuntime,
              memoryManager: params.memoryManager ?? ({
                getSnapshot() {
                  throw new Error("Memory manager is unavailable.");
                },
                getPlanningContext() {
                  return {
                    snapshot: null,
                    promptBlock: "",
                  };
                },
                search() {
                  return [];
                },
                write() {
                  throw new Error("Memory manager is unavailable.");
                },
                flushSessionSummary() {
                  return null;
                },
                captureRememberRequest() {
                  return null;
                },
              } as unknown as ReturnType<typeof createMemoryManager>),
              adapter: params.adapter as unknown as ProviderAdapter<ProviderKind>,
              secret: params.secret as ProviderSecret<ProviderKind>,
              model: params.model,
              signal: runSignal.signal,
              unsafeShellEnabled: params.unsafeShellEnabled,
              taskManager: params.taskManager,
              sessionManager: params.sessionManager,
              flowManager: params.flowManager,
              reasoningLevel: params.reasoningLevel,
              isDetachedTask: params.isDetachedTask,
              isHeartbeatRun: params.isHeartbeatRun,
              isSubagentRun: params.isSubagentRun,
              currentTaskId: params.currentTaskId,
              nestingDepth: params.nestingDepth ?? 0,
            })
          : await executeTool({
              toolCall: step.tool,
              conversationId: params.conversationId,
              agentId,
              runId: run.id,
              workspace: params.workspace,
              browserRuntime: params.browserRuntime,
              memoryManager: params.memoryManager ?? ({
                getSnapshot() {
                  throw new Error("Memory manager is unavailable.");
                },
                getPlanningContext() {
                  return {
                    snapshot: null,
                    promptBlock: "",
                  };
                },
                search() {
                  return [];
                },
                write() {
                  throw new Error("Memory manager is unavailable.");
                },
                flushSessionSummary() {
                  return null;
                },
                captureRememberRequest() {
                  return null;
                },
              } as unknown as ReturnType<typeof createMemoryManager>),
              adapter: params.adapter,
              secret: params.secret,
              model: params.model,
              reasoningLevel: params.reasoningLevel,
              signal: runSignal.signal,
              unsafeShellEnabled: params.unsafeShellEnabled,
              currentTaskId: params.currentTaskId,
              nestingDepth: params.nestingDepth ?? 0,
              isHeartbeatRun: params.isHeartbeatRun,
              isSubagentRun: params.isSubagentRun,
              taskManager: params.taskManager,
              sessionManager: params.sessionManager,
              flowManager: params.flowManager,
            });
      } catch (error) {
        const message = validationMessage(error);
        emit("error", { error: message, phase: "tool", tool: step.tool.name });
        failureEventRecorded = true;
        throw new AgentRunError(message, isAbortError(error) ? "cancelled" : "failed", run.id);
      }

      const changedFilesInResult = Array.isArray(result.changedFiles)
        ? result.changedFiles.filter((value): value is string => typeof value === "string")
        : [];

      for (const file of changedFilesInResult) {
        changedFiles.add(file);
      }

      const compactResult = {
        ...result,
        text: typeof result.text === "string" ? clipText(result.text, 5000) : result.text,
      };

      emit("tool_result", {
        tool: step.tool.name,
        result: compactResult,
      });
      params.sendEvent("tool_result", {
        tool: step.tool.name,
        result: compactResult,
        runId: run.id,
      });
      toolHistory.push({
        tool: step.tool.name,
        result: buildToolSummary(step.tool, compactResult),
      });
      patchRun({
        phase: "planning",
        checkpoint: makeCheckpoint(stepIndex + 1, maxSteps, toolHistory, changedFiles, step.tool.name),
      });
    }

    let continuationNote = "";
    if (!reachedFinalStep) {
      if (params.isDetachedTask || params.isHeartbeatRun) {
        const nextDepth = (params.nestingDepth ?? 0) + 1;
        if (params.taskManager && params.currentTaskId) {
          if (nextDepth <= 2) {
            const continuationTask = await params.taskManager.enqueueDetachedTask({
              agentId,
              conversationId: params.conversationId,
              prompt: buildContinuationPrompt({
                userMessage: params.userMessage,
                toolHistory,
                currentTaskId: params.currentTaskId,
                nestingDepth: params.nestingDepth,
              }),
              title: params.conversationTitle ?? (params.userMessage.trim().slice(0, 60) || "Continuation"),
              providerKind: params.providerKind,
              model: params.model,
              reasoningLevel: params.reasoningLevel,
              taskKind: "continuation",
              parentTaskId: params.currentTaskId,
              nestingDepth: nextDepth,
              startImmediately: true,
            });
            continuationNote = `A continuation task was queued (${continuationTask.id}) because the autonomous step budget was reached.`;
            emit("status", {
              message: "Autonomous step budget reached. Queuing continuation.",
              phase: "continuation_scheduled",
              taskId: continuationTask.id,
            });
            params.sendEvent("status", {
              message: "Autonomous step budget reached. Queuing continuation.",
              phase: "continuation_scheduled",
              taskId: continuationTask.id,
              runId: run.id,
            });
          }
        }
      }

      if (!continuationNote) {
        throw new AgentRunError(`Agent stopped after reaching the ${maxSteps}-step limit.`, "failed", run.id);
      }
    }

    if (runSignal.signal.aborted) {
      throw runSignal.signal.reason ?? createAbortError();
    }

    const finalInstructions = buildFinalInstructions({
      guides,
      toolHistory,
      changedFiles: [...changedFiles].sort(),
      soulBlock,
      standingOrdersBlock,
      runtimeContext,
      continuationNote,
    });
    patchRun({
      phase: "synthesizing",
      checkpoint: makeCheckpoint(maxSteps, maxSteps, toolHistory, changedFiles, null),
    });

    let assistantText = "";
    await params.adapter.streamFinalAnswer({
      secret: params.secret,
      model: params.model,
      reasoningLevel: params.reasoningLevel,
      instructions: finalInstructions,
      messages: params.messages,
      signal: runSignal.signal,
      onText: (chunk) => {
        assistantText += chunk;
        params.sendEvent("delta", { delta: chunk, runId: run.id });
      },
    });

    if (params.memoryManager) {
      const usedMemoryWrite = toolHistory.some((entry) => entry.tool === "memory_write");
      if (!usedMemoryWrite) {
        params.memoryManager.captureRememberRequest({
          agentId,
          message: params.userMessage,
        });
      }
      params.memoryManager.flushSessionSummary({
        agentId,
        conversationTitle: params.conversationTitle ?? "Session",
        userMessage: params.userMessage,
        assistantText,
      });
    }

    const completionPayload = {
      changedFiles: [...changedFiles].sort(),
    };
    params.sendEvent("run_complete", {
      runId: run.id,
      ...completionPayload,
    });
    finalize("completed", "run_complete", completionPayload);

    return {
      runId: run.id,
      assistantText,
      changedFiles: [...changedFiles].sort(),
    };
  } catch (error) {
    const status: Exclude<WorkspaceRunStatus, "running"> =
      error instanceof AgentRunError ? error.status : isAbortError(error) ? "cancelled" : "failed";
    const message =
      error instanceof Error
        ? error.message
        : status === "cancelled"
          ? "Agent run was cancelled."
          : "Agent runtime failed.";
    const eventType = status === "cancelled" ? "run_cancelled" : "run_failed";
    if (!failureEventRecorded) {
      emit("error", {
        error: message,
        phase: "terminal",
        status,
      });
      failureEventRecorded = true;
    }
    finalize(status, eventType, { error: message });
    if (error instanceof AgentRunError) {
      throw error;
    }
    throw new AgentRunError(message, status, run.id);
  } finally {
    runSignal.cleanup();
    await params.browserRuntime.closeSession(run.id).catch(() => undefined);
  }
}

async function executeTool<K extends ProviderKind>(params: {
  toolCall: ToolCall;
  conversationId: string;
  agentId: string;
  runId: string;
  workspace: ReturnType<typeof createWorkspaceManager>;
  browserRuntime: ReturnType<typeof createBrowserRuntime>;
  memoryManager: ReturnType<typeof createMemoryManager>;
  adapter: ProviderAdapter<K>;
  secret: ProviderSecret<K>;
  model: string;
  reasoningLevel: ReasoningLevel;
  signal: AbortSignal;
  unsafeShellEnabled?: boolean;
  currentTaskId?: string | null;
  nestingDepth: number;
  isHeartbeatRun?: boolean;
  isSubagentRun?: boolean;
  taskManager?: {
    enqueueDetachedTask: (input: {
      agentId: string;
      conversationId: string;
      prompt: string;
      title?: string;
      providerKind: ProviderKind;
      model: string;
      reasoningLevel: ReasoningLevel;
      taskKind?: TaskKind;
      parentTaskId?: string | null;
      nestingDepth?: number;
      scheduledFor?: number | null;
      startImmediately?: boolean;
      taskFlowId?: string | null;
      flowStepKey?: string | null;
      originRunId?: string | null;
    }) => Promise<{ id: string }>;
  };
  sessionManager?: {
    spawnSubagentSession: (input: {
      agentId: string;
      parentConversationId: string;
      parentRunId: string;
      prompt: string;
      title?: string;
      providerKind: ProviderKind;
      model: string;
      reasoningLevel: ReasoningLevel;
    }) => Promise<{
      session: { id: string; title: string; providerKind: ProviderKind; model: string; reasoningLevel: ReasoningLevel };
      task: { id: string };
    }>;
  };
  flowManager?: {
    createFlow: (input: {
      agentId: string;
      conversationId: string;
      title: string;
      originRunId?: string | null;
      steps: Array<{
        stepKey: string;
        title: string;
        prompt: string;
        dependencyStepKey?: string | null;
      }>;
    }) => Promise<{
      flow: { id: string; title: string; status: string };
      steps: Array<{ id: string; stepKey: string; title: string; status: string }>;
    }>;
  };
}) {
  const parser = ToolArgumentSchemas[params.toolCall.name];
  const args = parser.parse(params.toolCall.arguments);
  const scope = ("scope" in args ? (args.scope as WorkspaceScope | undefined) : undefined) ?? "sandbox";

  switch (params.toolCall.name) {
    case "list_tree": {
      const tree = params.workspace.listTree({
        conversationId: params.conversationId,
        scope,
        relativePath: typeof args.path === "string" ? args.path : ".",
        maxDepth: typeof args.maxDepth === "number" ? args.maxDepth : 3,
      });
      return { tree };
    }
    case "read_file": {
      const file = params.workspace.readFile({
        conversationId: params.conversationId,
        scope,
        relativePath: args.path as string,
      });
      return {
        path: file.path,
        binary: file.binary,
        unsupportedEncoding: file.unsupportedEncoding,
        encoding: file.encoding,
        text: file.binary ? "" : file.content,
      };
    }
    case "write_file": {
      const relativePath = params.workspace.writeFile({
        conversationId: params.conversationId,
        scope,
        relativePath: args.path as string,
        content: args.content as string,
      });
      return {
        path: relativePath,
        changedFiles: [relativePath],
      };
    }
    case "edit_file": {
      const relativePath = params.workspace.editFile({
        conversationId: params.conversationId,
        scope,
        relativePath: args.path as string,
        find: args.find as string,
        replace: args.replace as string,
        replaceAll: Boolean(args.replaceAll),
      });
      return {
        path: relativePath,
        changedFiles: [relativePath],
      };
    }
    case "make_dir": {
      const relativePath = params.workspace.makeDir({
        conversationId: params.conversationId,
        scope,
        relativePath: args.path as string,
      });
      return {
        path: relativePath,
      };
    }
    case "move_path": {
      const relativePath = params.workspace.movePath({
        conversationId: params.conversationId,
        scope,
        from: args.from as string,
        to: args.to as string,
      });
      return {
        path: relativePath,
        changedFiles: [relativePath],
      };
    }
    case "delete_path": {
      params.workspace.deletePath({
        conversationId: params.conversationId,
        scope,
        relativePath: args.path as string,
        recursive: Boolean(args.recursive),
      });
      return {
        path: args.path as string,
        deleted: true,
        changedFiles: [String(args.path)],
      };
    }
    case "exec_command": {
      const cwd = params.workspace.resolveSandboxDirectory({
        conversationId: params.conversationId,
        relativePath: typeof args.cwd === "string" ? args.cwd : ".",
      });
      const result = await runWorkspaceCommand({
        program: args.program as string,
        args: Array.isArray(args.args) ? (args.args as string[]) : [],
        timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
        cwd: cwd.absolutePath,
        signal: params.signal,
        allowUnsafeShell: params.unsafeShellEnabled,
      });
      return {
        program: args.program,
        args: args.args ?? [],
        cwd: cwd.relativePath,
        exitCode: result.exitCode,
        stdout: clipText(result.stdout, 5000),
        stderr: clipText(result.stderr, 3000),
        timedOut: result.timedOut,
      };
    }
    case "provider_web_search": {
      if (!params.adapter.searchWeb) {
        throw new Error("Current provider does not support provider_web_search.");
      }
      return await params.adapter.searchWeb({
        secret: params.secret,
        model: params.model,
        query: args.query as string,
        signal: params.signal,
      });
    }
    case "duckduckgo_search": {
      const results = await searchDuckDuckGo(
        args.query as string,
        typeof args.maxResults === "number" ? args.maxResults : 5,
      );
      return {
        query: args.query,
        results,
      };
    }
    case "web_fetch": {
      return await fetchWebPage(args.url as string, { signal: params.signal });
    }
    case "browser_search": {
      return await params.browserRuntime.search({
        sessionId: params.runId,
        conversationId: params.conversationId,
        query: args.query as string,
        signal: params.signal,
      });
    }
    case "browser_open": {
      return await params.browserRuntime.open({
        sessionId: params.runId,
        conversationId: params.conversationId,
        url: args.url as string,
        signal: params.signal,
      });
    }
    case "browser_snapshot": {
      return await params.browserRuntime.snapshot({
        sessionId: params.runId,
        conversationId: params.conversationId,
      });
    }
    case "browser_extract": {
      return await params.browserRuntime.extract({
        sessionId: params.runId,
        conversationId: params.conversationId,
        selector: typeof args.selector === "string" ? args.selector : undefined,
      });
    }
    case "browser_click": {
      return await params.browserRuntime.click({
        sessionId: params.runId,
        conversationId: params.conversationId,
        selector: args.selector as string,
        signal: params.signal,
      });
    }
    case "browser_type": {
      return await params.browserRuntime.type({
        sessionId: params.runId,
        conversationId: params.conversationId,
        selector: args.selector as string,
        text: args.text as string,
        submit: Boolean(args.submit),
        signal: params.signal,
      });
    }
    case "browser_back": {
      return await params.browserRuntime.back({
        sessionId: params.runId,
        conversationId: params.conversationId,
        signal: params.signal,
      });
    }
    case "browser_close": {
      await params.browserRuntime.closeSession(params.runId);
      return { closed: true };
    }
    case "memory_get": {
      return params.workspace.readAgentMemory(params.agentId);
    }
    case "memory_search": {
      return {
        query: args.query,
        results: params.memoryManager.search(
          params.agentId,
          args.query as string,
          typeof args.maxResults === "number" ? args.maxResults : undefined,
        ),
      };
    }
    case "memory_write": {
      const memory = params.memoryManager.write({
        agentId: params.agentId,
        content: args.content as string,
        target: args.target === "daily" ? "daily" : "durable",
      });
      return {
        agentId: params.agentId,
        target: args.target === "daily" ? "daily" : "durable",
        memory,
      };
    }
    case "spawn_subagent_session": {
      if (!params.sessionManager) {
        throw new Error("Sub-agent session manager is unavailable.");
      }
      if (!params.runId) {
        throw new Error("Sub-agent sessions require an active run.");
      }
      const child = await params.sessionManager.spawnSubagentSession({
        agentId: params.agentId,
        parentConversationId: params.conversationId,
        parentRunId: params.runId,
        prompt: args.prompt as string,
        title: typeof args.title === "string" ? args.title : undefined,
        providerKind: (args.providerKind as ProviderKind | undefined) ?? params.adapter.kind,
        model: typeof args.model === "string" ? (args.model as string) : params.model,
        reasoningLevel:
          (args.reasoningLevel as ReasoningLevel | undefined) ?? params.reasoningLevel,
      });
      return {
        sessionId: child.session.id,
        taskId: child.task.id,
        title: child.session.title,
        providerKind: child.session.providerKind,
        model: child.session.model,
        reasoningLevel: child.session.reasoningLevel,
      };
    }
    case "spawn_task": {
      if (!params.taskManager) {
        throw new Error("Task manager is unavailable.");
      }
      const nextDepth = getNextNestingDepth(params.nestingDepth);
      const task = await params.taskManager.enqueueDetachedTask({
        agentId: params.agentId,
        conversationId: params.conversationId,
        prompt: args.prompt as string,
        title: typeof args.title === "string" ? args.title : undefined,
        providerKind: params.adapter.kind,
        model: params.model,
        reasoningLevel: params.reasoningLevel,
        taskKind: "detached",
        parentTaskId: params.currentTaskId ?? null,
        nestingDepth: nextDepth,
      });
      return {
        taskId: task.id,
        status: "queued",
      };
    }
    case "schedule_task": {
      if (!params.taskManager) {
        throw new Error("Task manager is unavailable.");
      }
      const nextDepth = getNextNestingDepth(params.nestingDepth);
      const scheduledFor =
        typeof args.scheduledFor === "number"
          ? args.scheduledFor
          : typeof args.delayMs === "number"
            ? Date.now() + args.delayMs
            : null;
      if (scheduledFor == null) {
        throw new Error("schedule_task requires delayMs or scheduledFor.");
      }
      const task = await params.taskManager.enqueueDetachedTask({
        agentId: params.agentId,
        conversationId: params.conversationId,
        prompt: args.prompt as string,
        title: typeof args.title === "string" ? args.title : undefined,
        providerKind: params.adapter.kind,
        model: params.model,
        reasoningLevel: params.reasoningLevel,
        taskKind: "scheduled",
        parentTaskId: params.currentTaskId ?? null,
        nestingDepth: nextDepth,
        scheduledFor,
        startImmediately: false,
      });
      return {
        taskId: task.id,
        status: "queued",
        scheduledFor,
      };
    }
    case "create_task_flow": {
      if (!params.flowManager) {
        throw new Error("Task flow manager is unavailable.");
      }
      const created = await params.flowManager.createFlow({
        agentId: params.agentId,
        conversationId: params.conversationId,
        title: args.title as string,
        originRunId: params.runId,
        steps: (args.steps as Array<{
          stepKey: string;
          title: string;
          prompt: string;
          dependencyStepKey?: string;
        }>).map((step) => ({
          stepKey: step.stepKey,
          title: step.title,
          prompt: step.prompt,
          dependencyStepKey: step.dependencyStepKey ?? null,
        })),
      });
      return {
        flowId: created.flow.id,
        status: created.flow.status,
        steps: created.steps.map((step) => ({
          id: step.id,
          stepKey: step.stepKey,
          status: step.status,
        })),
      };
    }
    default:
      throw new Error(`Unknown tool: ${params.toolCall.name}`);
  }
}
