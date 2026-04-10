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
  ToolPermission,
} from "../types.js";

export interface ToolDescriptor {
  name: string;
  description: string;
  permission: ToolPermission;
  schema: z.ZodType<Record<string, unknown>>;
  example: string;
  execute: (params: {
    arguments: Record<string, unknown>;
    agentId: string;
    conversationId: string;
    runId: string;
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
      }) => Promise<{ id: string }>;
    };
    reasoningLevel: ReasoningLevel;
    isDetachedTask?: boolean;
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

  async function execute(
    toolCall: ToolCall,
    context: Omit<Parameters<ToolDescriptor["execute"]>[0], "arguments">,
  ) {
    const descriptor = get(toolCall.name);
    if (!descriptor) {
      throw new Error(`Unknown tool: ${toolCall.name}`);
    }

    const args = descriptor.schema.parse(toolCall.arguments);
    return descriptor.execute({
      ...context,
      arguments: args,
    });
  }

  function buildPlannerGuide() {
    return list()
      .map(
        (tool) =>
          `- ${tool.name} [${tool.permission}]: ${tool.description}\n  Example: ${tool.example}`,
      )
      .join("\n");
  }

  return {
    register,
    get,
    list,
    execute,
    buildPlannerGuide,
  };
}
