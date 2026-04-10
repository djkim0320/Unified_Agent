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
  ProviderKind,
  ProviderSecret,
  ReasoningLevel,
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
    getConversation: (conversationId: string) => {
      id: string;
      agentId: string;
      title: string;
      providerKind: ProviderKind;
      model: string;
      reasoningLevel: ReasoningLevel;
    } | null;
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
      scheduledFor?: number | null;
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
    listTasks: (agentId: string) => unknown[];
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
  };
  resolveSecret: (kind: ProviderKind) => Promise<ProviderSecret<ProviderKind> | null>;
}) {
  const toolRegistry = createToolRegistry();
  registerCoreTools(toolRegistry);
  const pluginManager = createPluginManager({
    projectRoot: params.projectRoot,
    builtInPlugins: [corePlugin],
  });
  const memoryManager = createMemoryManager(params.workspace);

  async function executeDetachedTask(paramsInput: {
    task: {
      id: string;
      agentId: string;
      conversationId: string;
      prompt: string;
      providerKind: ProviderKind;
      model: string;
      reasoningLevel: ReasoningLevel;
    };
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

    return runAgentTurn({
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
      store: params.store,
      signal: paramsInput.signal,
      isDetachedTask: true,
      conversationTitle: conversation.title,
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
  }

  const taskManager = createTaskManager({
    store: params.store as never,
    executeTask: executeDetachedTask,
    schedulerEnabled: process.env.ENABLE_AGENT_AUTOMATIONS === "true",
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
    runForegroundTurn,
  };
}
