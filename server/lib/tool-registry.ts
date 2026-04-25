import { z } from "zod";
import type { createBrowserRuntime } from "./browser-runtime.js";
import type { createMemoryManager } from "./memory-manager.js";
import type { createWorkspaceManager } from "./workspace.js";
import type { ProviderAdapter } from "../providers/base.js";
import type {
  ProviderKind,
  ProviderSecret,
  ReasoningLevel,
  ToolCall,
  ToolConcurrencyClass,
  ToolPermission,
  ToolRiskLevel,
  TaskKind,
  ConversationRecord,
  TaskFlowRecord,
  TaskFlowStepRecord,
} from "../types.js";

export interface ToolDescriptor {
  name: string;
  description: string;
  permission: ToolPermission;
  schema: z.ZodType<Record<string, unknown>>;
  example: string;
  risk?: ToolRiskLevel;
  costHint?: "cheap" | "moderate" | "expensive";
  concurrencyClass?: ToolConcurrencyClass;
  batchable?: boolean;
  rolePolicy?: {
    allowPrimary?: boolean;
    allowSubagent?: boolean;
    maxNestingDepth?: number | null;
  };
  audit?: {
    category?: string;
    safeByDefault?: boolean;
  };
  execute: (params: {
    arguments: Record<string, unknown>;
    agentId: string;
    conversationId: string;
    runId: string;
    currentTaskId?: string | null;
    nestingDepth: number;
    isHeartbeatRun?: boolean;
    workspace: ReturnType<typeof createWorkspaceManager>;
    browserRuntime: ReturnType<typeof createBrowserRuntime>;
    memoryManager: ReturnType<typeof createMemoryManager>;
    adapter: ProviderAdapter<ProviderKind>;
    secret: ProviderSecret<ProviderKind>;
    model: string;
    signal: AbortSignal;
    unsafeShellEnabled?: boolean;
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
    reasoningLevel: ReasoningLevel;
    isDetachedTask?: boolean;
    isSubagentRun?: boolean;
  }) => Promise<Record<string, unknown>>;
}

export function createToolRegistry() {
  const tools = new Map<string, ToolDescriptor>();

  function register(descriptor: ToolDescriptor) {
    tools.set(descriptor.name, descriptor);
  }

  function get(name: string) {
    return tools.get(name) ?? null;
  }

  function list() {
    return [...tools.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  function listAllowed(context?: { isSubagent?: boolean; nestingDepth?: number }) {
    return list().filter((tool) => {
      const policy = tool.rolePolicy;
      if (!policy) {
        return true;
      }
      if (context?.isSubagent && policy.allowSubagent === false) {
        return false;
      }
      if (!context?.isSubagent && policy.allowPrimary === false) {
        return false;
      }
      if (
        typeof policy.maxNestingDepth === "number" &&
        (context?.nestingDepth ?? 0) > policy.maxNestingDepth
      ) {
        return false;
      }
      return true;
    });
  }

  async function execute(
    toolCall: ToolCall,
    context: Omit<Parameters<ToolDescriptor["execute"]>[0], "arguments">,
  ) {
    const descriptor = get(toolCall.name);
    if (!descriptor) {
      throw new Error(`Unknown tool: ${toolCall.name}`);
    }
    if (
      descriptor.rolePolicy?.allowSubagent === false &&
      Boolean((context as { isSubagentRun?: boolean }).isSubagentRun)
    ) {
      throw new Error(`Tool ${toolCall.name} is not available inside sub-agent runs.`);
    }
    if (
      descriptor.rolePolicy?.allowPrimary === false &&
      !Boolean((context as { isSubagentRun?: boolean }).isSubagentRun)
    ) {
      throw new Error(`Tool ${toolCall.name} is not available in primary runs.`);
    }
    if (
      typeof descriptor.rolePolicy?.maxNestingDepth === "number" &&
      (context.nestingDepth ?? 0) > descriptor.rolePolicy.maxNestingDepth
    ) {
      throw new Error(`Tool ${toolCall.name} exceeds the allowed nesting depth.`);
    }

    const args = descriptor.schema.parse(toolCall.arguments);
    return descriptor.execute({
      ...context,
      arguments: args,
    });
  }

  function buildPlannerGuide(context?: { isSubagent?: boolean; nestingDepth?: number }) {
    return listAllowed(context)
      .map(
        (tool) =>
          `- ${tool.name} [${tool.permission}${tool.risk ? ` / risk:${tool.risk}` : ""}${tool.costHint ? ` / cost:${tool.costHint}` : ""}]: ${tool.description}\n  Example: ${tool.example}`,
      )
      .join("\n");
  }

  return {
    register,
    get,
    list,
    listAllowed,
    execute,
    buildPlannerGuide,
  };
}
