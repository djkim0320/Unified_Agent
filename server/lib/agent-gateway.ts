import { createMemoryManager } from "./memory-manager.js";
import { createPluginManager } from "./plugin-manager.js";
import { runAgentTurn } from "./agent-runtime.js";
import { createTaskManager } from "./task-manager.js";
import { createToolRegistry } from "./tool-registry.js";
import { corePlugin, registerCoreTools } from "../plugins/core.js";
import { getProviderAdapter } from "../provider-registry.js";
import type {
  AgentRecord,
  ChatMessage,
  ConversationRecord,
  HeartbeatLogRecord,
  MemorySearchResult,
  ProviderKind,
  ProviderSecret,
  ReasoningLevel,
  TaskKind,
  TaskFlowRecord,
  TaskFlowStepRecord,
  TaskRecord,
  WorkspaceRunEventRecord,
} from "../types.js";
import type { createBrowserRuntime } from "./browser-runtime.js";
import type { createWorkspaceManager } from "./workspace.js";

export function createAgentGateway(params: {
  projectRoot: string;
  workspace: ReturnType<typeof createWorkspaceManager>;
  browserRuntime: ReturnType<typeof createBrowserRuntime>;
  store: {
    getAgent: (agentId: string) => AgentRecord | null;
    getConversation: (conversationId: string) => ConversationRecord | null;
    listConversations: (
      agentId?: string,
      options?: {
        includeSubagents?: boolean;
        parentConversationId?: string | null;
        ownerRunId?: string | null;
        sessionKind?: ConversationRecord["sessionKind"];
      },
    ) => ConversationRecord[];
    saveConversation: (input: {
      id?: string;
      agentId?: string;
      channelKind?: "webchat";
      sessionKind?: ConversationRecord["sessionKind"];
      parentConversationId?: string | null;
      ownerRunId?: string | null;
      title: string;
      providerKind: ProviderKind;
      model: string;
      reasoningLevel: ReasoningLevel;
    }) => ConversationRecord;
    listMessages: (conversationId: string) => Array<{
      role: "user" | "assistant";
      content: string;
    }>;
    appendMessage: (input: {
      conversationId: string;
      role: "assistant";
      content: string;
    }) => { id: string };
    createWorkspaceRun: (input: {
      conversationId: string;
      providerKind: ProviderKind;
      model: string;
      userMessage: string;
    }) => { id: string };
    appendWorkspaceRunEvent: (input: {
      runId: string;
      eventType: "status" | "tool_call" | "tool_result" | "error" | "run_complete" | "run_failed" | "run_cancelled";
      payload: Record<string, unknown>;
    }) => WorkspaceRunEventRecord;
    finalizeWorkspaceRun: (
      id: string,
      status: "completed" | "failed" | "cancelled",
      eventType: WorkspaceRunEventRecord["eventType"],
      payload: Record<string, unknown>,
    ) => { finalized: boolean; run: unknown };
    createTask: (input: {
      agentId: string;
      conversationId: string;
      title: string;
      prompt: string;
      providerKind: ProviderKind;
      model: string;
      reasoningLevel: ReasoningLevel;
      taskKind?: TaskKind;
      parentTaskId?: string | null;
      nestingDepth?: number;
      scheduledFor?: number | null;
      taskFlowId?: string | null;
      flowStepKey?: string | null;
      originRunId?: string | null;
    }) => unknown;
    getTask: (taskId: string) => {
      id: string;
      agentId: string;
      conversationId: string;
      title: string;
      prompt: string;
      providerKind: ProviderKind;
      model: string;
      reasoningLevel: ReasoningLevel;
      status: string;
    } | null;
    listTasks: (agentId: string) => TaskRecord[];
    listHeartbeatLogs: (agentId: string) => HeartbeatLogRecord[];
    createHeartbeatLog: (input: {
      agentId: string;
      conversationId: string;
      triggerSource?: "manual" | "scheduler";
      taskId?: string | null;
      status?: HeartbeatLogRecord["status"];
      summary?: string | null;
      errorText?: string | null;
      startedAt?: number | null;
      completedAt?: number | null;
    }) => HeartbeatLogRecord;
    transitionHeartbeatLog: (input: {
      id: string;
      taskId?: string | null;
      status?: HeartbeatLogRecord["status"];
      summary?: string | null;
      errorText?: string | null;
      startedAt?: number | null;
      completedAt?: number | null;
    }) => HeartbeatLogRecord | null;
    transitionTask: (input: {
      taskId: string;
      status: "queued" | "running" | "completed" | "failed" | "timed_out" | "cancelled";
      eventType: "queued" | "running" | "status" | "completed" | "failed" | "timed_out" | "cancelled" | "result_delivered";
      payload?: Record<string, unknown>;
      runId?: string | null;
      resultText?: string | null;
    }) => unknown;
    appendTaskEvent: (input: {
      taskId: string;
      eventType: "queued" | "running" | "status" | "completed" | "failed" | "timed_out" | "cancelled" | "result_delivered";
      payload: Record<string, unknown>;
    }) => unknown;
    replaceMemoryIndex?: (
      agentId: string,
      entries: Array<{
        path: string;
        kind: MemorySearchResult["kind"];
        line: number;
        reason: string;
        text: string;
      }>,
    ) => number;
    searchMemoryIndex?: (agentId: string, query: string, maxResults?: number) => MemorySearchResult[];
    createTaskFlow?: (input: {
      agentId: string;
      conversationId: string;
      title: string;
      triggerSource?: "manual" | "schedule" | "event_hook";
      originRunId?: string | null;
    }) => TaskFlowRecord;
    getTaskFlow?: (flowId: string) => TaskFlowRecord | null;
    listTaskFlows?: (agentId: string) => TaskFlowRecord[];
    transitionTaskFlow?: (input: {
      flowId: string;
      status?: TaskFlowRecord["status"];
      resultSummary?: string | null;
      errorText?: string | null;
      completedAt?: number | null;
    }) => TaskFlowRecord | null;
    createTaskFlowStep?: (input: {
      flowId: string;
      stepKey: string;
      dependencyStepKey?: string | null;
      title: string;
      prompt: string;
    }) => TaskFlowStepRecord;
    getTaskFlowStep?: (stepId: string) => TaskFlowStepRecord | null;
    listTaskFlowSteps?: (flowId: string) => TaskFlowStepRecord[];
    transitionTaskFlowStep?: (input: {
      stepId: string;
      taskId?: string | null;
      status?: TaskFlowStepRecord["status"];
      completedAt?: number | null;
    }) => TaskFlowStepRecord | null;
  };
  resolveSecret: (kind: ProviderKind) => Promise<ProviderSecret<ProviderKind> | null>;
}) {
  const toolRegistry = createToolRegistry();
  registerCoreTools(toolRegistry);
  const pluginManager = createPluginManager({
    projectRoot: params.projectRoot,
    builtInPlugins: [corePlugin],
  });
  const memoryIndexStore =
    params.store.replaceMemoryIndex && params.store.searchMemoryIndex
      ? {
          replaceMemoryIndex: params.store.replaceMemoryIndex.bind(params.store),
          searchMemoryIndex: params.store.searchMemoryIndex.bind(params.store),
        }
      : undefined;
  const memoryManager = createMemoryManager({
    workspace: params.workspace,
    store: memoryIndexStore,
  });

  function resolveHeartbeatConversation(agent: AgentRecord) {
    const existing = params.store.listConversations(agent.id)[0];
    if (existing) {
      return existing;
    }
    const conversation = params.store.saveConversation({
      agentId: agent.id,
      title: "Heartbeat",
      providerKind: agent.providerKind,
      model: agent.model,
      reasoningLevel: agent.reasoningLevel,
    });
    params.workspace.createConversationWorkspace(conversation.id);
    return conversation;
  }

  function buildHeartbeatTaskPrompt(paramsInput: {
    agent: AgentRecord;
    soulContent: string;
    heartbeat: {
      enabled: boolean;
      intervalMinutes: number;
      lastRun: string | null;
      instructions: string;
    };
    conversationTitle: string;
  }) {
    return [
      `Heartbeat trigger for agent ${paramsInput.agent.name}.`,
      `Conversation: ${paramsInput.conversationTitle}`,
      "",
      "SOUL.md",
      paramsInput.soulContent.trim() || "(empty)",
      "",
      "HEARTBEAT.md",
      `enabled: ${paramsInput.heartbeat.enabled}`,
      `interval_minutes: ${paramsInput.heartbeat.intervalMinutes}`,
      `last_run: ${paramsInput.heartbeat.lastRun ?? "null"}`,
      "",
      paramsInput.heartbeat.instructions.trim() || "(empty)",
    ].join("\n");
  }

  async function executeDetachedTask(paramsInput: {
    task: TaskRecord;
    signal: AbortSignal;
    onStatus: (payload: Record<string, unknown>) => void;
  }) {
    const conversation = params.store.getConversation(paramsInput.task.conversationId);
    const agent = conversation ? params.store.getAgent(conversation.agentId) : null;
    if (!conversation || !agent) {
      throw new Error("Detached task session or agent was not found.");
    }

    const adapter = getProviderAdapter(paramsInput.task.providerKind);
    const secret = await params.resolveSecret(paramsInput.task.providerKind);
    if (!secret) {
      throw new Error(`${adapter.label} must be configured before running this task.`);
    }

    const messages: ChatMessage[] = params.store.listMessages(conversation.id).map((message) => ({
      role: message.role,
      content: message.content,
    }));
    messages.push({
      role: "user",
      content: paramsInput.task.prompt,
    });

    const result = await runAgentTurn({
      agent,
      adapter: adapter as never,
      secret: secret as never,
      providerKind: paramsInput.task.providerKind,
      model: paramsInput.task.model,
      reasoningLevel: paramsInput.task.reasoningLevel,
      conversationId: conversation.id,
      agentId: agent.id,
      userMessage: paramsInput.task.prompt,
      messages,
      workspace: params.workspace,
      browserRuntime: params.browserRuntime,
      memoryManager,
      pluginManager,
      toolRegistry,
      taskManager,
      sessionManager: {
        spawnSubagentSession,
      },
      flowManager: {
        createFlow,
      },
      store: params.store,
      signal: paramsInput.signal,
      isDetachedTask: paramsInput.task.taskKind !== "heartbeat" && paramsInput.task.taskKind !== "subagent",
      isHeartbeatRun: paramsInput.task.taskKind === "heartbeat",
      isSubagentRun: paramsInput.task.taskKind === "subagent",
      currentTaskId: paramsInput.task.id,
      nestingDepth: paramsInput.task.nestingDepth ?? 0,
      conversationTitle: conversation.title,
      parentRunId: paramsInput.task.originRunId ?? conversation.ownerRunId ?? null,
      sendEvent(eventName, payload) {
        if (eventName === "delta") {
          return;
        }
        paramsInput.onStatus({
          eventName,
          ...payload,
        });
      },
    });
    if (
      paramsInput.task.taskKind === "detached" ||
      paramsInput.task.taskKind === "subagent" ||
      paramsInput.task.taskKind === "flow_step"
    ) {
      memoryManager.captureOutcome({
        agentId: agent.id,
        taskTitle: paramsInput.task.title,
        assistantText: result.assistantText,
      });
    }
    return result;
  }

  let taskManager: ReturnType<typeof createTaskManager>;

  async function queueHeartbeatTask(input: {
    agentId: string;
    triggerSource: "manual" | "scheduler";
  }) {
    const agent = params.store.getAgent(input.agentId);
    if (!agent) {
      throw new Error("Agent not found.");
    }

    const activeHeartbeat = params.store
      .listTasks(agent.id)
      .some(
        (task) =>
          (task.taskKind ?? "detached") === "heartbeat" &&
          (task.status === "queued" || task.status === "running"),
      );
    if (activeHeartbeat) {
      if (input.triggerSource === "scheduler") {
        return null;
      }
      throw new Error("A heartbeat task is already queued or running.");
    }

    const heartbeat = params.workspace.readAgentHeartbeat(agent.id);
    const soul = params.workspace.readAgentSoul(agent.id);
    const conversation = resolveHeartbeatConversation(agent);
    const triggeredAt = new Date().toISOString();
    const heartbeatLog = params.store.createHeartbeatLog({
      agentId: agent.id,
      conversationId: conversation.id,
      triggerSource: input.triggerSource,
      status: "queued",
      summary:
        input.triggerSource === "manual"
          ? "Heartbeat task queued."
          : "Scheduled heartbeat task queued.",
    });
    const task = await taskManager.enqueueDetachedTask({
      agentId: agent.id,
      conversationId: conversation.id,
      title: `Heartbeat: ${agent.name}`,
      prompt: buildHeartbeatTaskPrompt({
        agent,
        soulContent: soul.content,
        heartbeat,
        conversationTitle: conversation.title,
      }),
      providerKind: conversation.providerKind,
      model: conversation.model,
      reasoningLevel: conversation.reasoningLevel,
      taskKind: "heartbeat",
      startImmediately: input.triggerSource === "manual",
    });
    const log = params.store.transitionHeartbeatLog({
      id: heartbeatLog.id,
      taskId: task.id,
      summary: `Heartbeat task ${task.id} queued.`,
    }) ?? heartbeatLog;
    const updatedHeartbeat = params.workspace.writeAgentHeartbeat(agent.id, {
      enabled: heartbeat.enabled,
      intervalMinutes: heartbeat.intervalMinutes,
      lastRun: triggeredAt,
      instructions: heartbeat.instructions,
    });

    return {
      heartbeat: updatedHeartbeat,
      heartbeatLog: log,
      task,
      conversation,
    };
  }

  async function spawnSubagentSession(input: {
    agentId: string;
    parentConversationId: string;
    parentRunId: string;
    prompt: string;
    title?: string;
    providerKind: ProviderKind;
    model: string;
    reasoningLevel: ReasoningLevel;
  }) {
    const parentConversation = params.store.getConversation(input.parentConversationId);
    if (!parentConversation || parentConversation.agentId !== input.agentId) {
      throw new Error("Parent session not found for sub-agent spawn.");
    }
    const siblingSubagents = params.store.listConversations(input.agentId, {
      sessionKind: "subagent",
      ownerRunId: input.parentRunId,
    });
    if (siblingSubagents.length >= 3) {
      throw new Error("Sub-agent concurrency is limited to 3 child sessions per run.");
    }

    const session = params.store.saveConversation({
      agentId: input.agentId,
      channelKind: "webchat",
      sessionKind: "subagent",
      parentConversationId: parentConversation.id,
      ownerRunId: input.parentRunId,
      title: input.title ?? `Sub-agent ${siblingSubagents.length + 1}`,
      providerKind: input.providerKind,
      model: input.model,
      reasoningLevel: input.reasoningLevel,
    });
    params.workspace.createConversationWorkspace(session.id);

    const task = await taskManager.enqueueDetachedTask({
      agentId: input.agentId,
      conversationId: session.id,
      prompt: input.prompt,
      title: input.title ?? `Sub-agent ${siblingSubagents.length + 1}`,
      providerKind: input.providerKind,
      model: input.model,
      reasoningLevel: input.reasoningLevel,
      taskKind: "subagent",
      parentTaskId: null,
      nestingDepth: 1,
      originRunId: input.parentRunId,
      startImmediately: true,
    });

    return {
      session,
      task,
    };
  }

  async function createFlow(input: {
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
  }) {
    if (!params.store.createTaskFlow || !params.store.createTaskFlowStep) {
      throw new Error("Task flow storage is unavailable.");
    }
    const conversation = params.store.getConversation(input.conversationId);
    if (!conversation || conversation.agentId !== input.agentId) {
      throw new Error("Session not found for task flow.");
    }
    const flow = params.store.createTaskFlow({
      agentId: input.agentId,
      conversationId: input.conversationId,
      title: input.title,
      triggerSource: "manual",
      originRunId: input.originRunId ?? null,
    });
    const steps = input.steps.map((step) =>
      params.store.createTaskFlowStep!({
        flowId: flow.id,
        stepKey: step.stepKey,
        dependencyStepKey: step.dependencyStepKey ?? null,
        title: step.title,
        prompt: step.prompt,
      }),
    );
    await taskManager.startTaskFlow(flow.id).catch(() => undefined);
    return {
      flow,
      steps,
    };
  }

  taskManager = createTaskManager({
    store: params.store as never,
    executeTask: executeDetachedTask,
    schedulerEnabled: process.env.ENABLE_AGENT_AUTOMATIONS === "true",
    getHeartbeatState(agentId) {
      try {
        return params.workspace.readAgentHeartbeat(agentId);
      } catch {
        return null;
      }
    },
    scheduleHeartbeatRun: queueHeartbeatTask,
  });

  async function runForegroundTurn(paramsInput: {
    conversationId: string;
    providerKind: ProviderKind;
    model: string;
    reasoningLevel: ReasoningLevel;
    userMessage: string;
    signal?: AbortSignal;
    unsafeShellEnabled?: boolean;
    sendEvent: (eventName: string, payload: Record<string, unknown>) => void;
  }) {
    const conversation = params.store.getConversation(paramsInput.conversationId);
    if (!conversation) {
      throw new Error("Conversation not found.");
    }
    const agent = params.store.getAgent(conversation.agentId);
    if (!agent) {
      throw new Error("Agent not found.");
    }
    const adapter = getProviderAdapter(paramsInput.providerKind);
    const secret = await params.resolveSecret(paramsInput.providerKind);
    if (!secret) {
      throw new Error(`${adapter.label} must be configured first.`);
    }

    return runAgentTurn({
      agent,
      adapter: adapter as never,
      secret: secret as never,
      providerKind: paramsInput.providerKind,
      model: paramsInput.model,
      reasoningLevel: paramsInput.reasoningLevel,
      conversationId: conversation.id,
      agentId: agent.id,
      userMessage: paramsInput.userMessage,
      messages: params.store.listMessages(conversation.id).map((message) => ({
        role: message.role,
        content: message.content,
      })),
      workspace: params.workspace,
      browserRuntime: params.browserRuntime,
      memoryManager,
      pluginManager,
      toolRegistry,
      taskManager,
      sessionManager: {
        spawnSubagentSession,
      },
      flowManager: {
        createFlow,
      },
      store: params.store,
      sendEvent: paramsInput.sendEvent,
      signal: paramsInput.signal,
      unsafeShellEnabled: paramsInput.unsafeShellEnabled,
      conversationTitle: conversation.title,
    });
  }

  return {
    toolRegistry,
    pluginManager,
    memoryManager,
    taskManager,
    queueHeartbeatTask,
    spawnSubagentSession,
    createFlow,
    runForegroundTurn,
  };
}
