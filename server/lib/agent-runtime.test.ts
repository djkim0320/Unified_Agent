import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentTurn, AgentRunError } from "./agent-runtime.js";
import { createMemoryManager } from "./memory-manager.js";
import { createAbortError } from "./process-control.js";
import { createToolRegistry } from "./tool-registry.js";
import { createWorkspaceManager } from "./workspace.js";
import { registerCoreTools } from "../plugins/core.js";
import type {
  AgentRecord,
  ChatMessage,
  ToolCall,
  WorkspaceRunEventRecord,
  WorkspaceRunStatus,
} from "../types.js";

function createTempProjectRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-runtime-"));
}

afterEach(() => {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith("agent-runtime-")) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
});

function createHarness() {
  const projectRoot = createTempProjectRoot();
  const conversationId = "conversation-1";
  const workspace = createWorkspaceManager(projectRoot, {
    conversationExists: (id) => id === conversationId,
  });
  workspace.createConversationWorkspace(conversationId);

  const events: Array<{
    eventType: WorkspaceRunEventRecord["eventType"];
    payload: Record<string, unknown>;
  }> = [];
  const finalizations: Array<{
    status: Exclude<WorkspaceRunStatus, "running">;
    eventType: WorkspaceRunEventRecord["eventType"];
    payload: Record<string, unknown>;
  }> = [];
  const runCreations: Array<Record<string, unknown>> = [];
  const runPatches: Array<Record<string, unknown>> = [];
  const sseEvents: Array<{ eventName: string; payload: Record<string, unknown> }> = [];

  const store = {
    createWorkspaceRun(input: Record<string, unknown>) {
      runCreations.push(input);
      return { id: "run-1" };
    },
    patchWorkspaceRun(input: Record<string, unknown>) {
      runPatches.push(input);
      return input;
    },
    appendWorkspaceRunEvent(input: {
      runId: string;
      eventType: WorkspaceRunEventRecord["eventType"];
      payload: Record<string, unknown>;
    }) {
      events.push({
        eventType: input.eventType,
        payload: input.payload,
      });
      return {
        id: `event-${events.length}`,
        runId: input.runId,
        eventType: input.eventType,
        payload: input.payload,
        createdAt: Date.now(),
      } satisfies WorkspaceRunEventRecord;
    },
    finalizeWorkspaceRun(
      _id: string,
      status: Exclude<WorkspaceRunStatus, "running">,
      eventType: WorkspaceRunEventRecord["eventType"],
      payload: Record<string, unknown>,
    ) {
      finalizations.push({ status, eventType, payload });
      return {
        finalized: finalizations.length === 1,
        run: { id: "run-1", status },
      };
    },
  };

  const browserRuntime = {
    async closeSession() {
      return undefined;
    },
    async search() {
      return { query: "", results: [] };
    },
    async open() {
      return { url: "https://example.com", title: "Example" };
    },
    async snapshot() {
      return { url: "https://example.com", title: "Example", text: "snapshot" };
    },
    async extract() {
      return { url: "https://example.com", title: "Example", text: "extract" };
    },
    async click() {
      return { url: "https://example.com", title: "Example" };
    },
    async type() {
      return { url: "https://example.com", title: "Example" };
    },
    async back() {
      return { url: "https://example.com", title: "Example" };
    },
  };

  const baseMessages: ChatMessage[] = [
    {
      role: "user",
      content: "Do the task",
    },
  ];

  return {
    conversationId,
    workspace,
    browserRuntime: browserRuntime as never,
    store,
    runCreations,
    runPatches,
    events,
    finalizations,
    sseEvents,
    sendEvent(eventName: string, payload: Record<string, unknown>) {
      sseEvents.push({ eventName, payload });
    },
    baseParams: {
      providerKind: "openai" as const,
      model: "gpt-5.4",
      reasoningLevel: "medium" as const,
      conversationId,
      userMessage: "Do the task",
      messages: baseMessages,
      workspace,
      browserRuntime: browserRuntime as never,
      store,
      sendEvent(eventName: string, payload: Record<string, unknown>) {
        sseEvents.push({ eventName, payload });
      },
    },
  };
}

function createAdapter(
  steps: Array<
    | { kind: "step"; value: { type: "final_answer" } | { type: "tool_call"; tool: ToolCall } }
    | { kind: "error"; error: Error }
  >,
  streamImpl?: (params: { onText: (chunk: string) => void; signal?: AbortSignal }) => Promise<void>,
  planSpy?: (params: { instructions: string }) => void,
  streamSpy?: (params: { instructions: string }) => void,
) {
  let index = 0;
  return {
    kind: "openai" as const,
    label: "OpenAI",
    defaultModel: "gpt-5.4",
    async listModels() {
      return ["gpt-5.4"];
    },
    async testConnection() {
      return { ok: true, message: "ok" };
    },
    async planToolStep(params: { instructions: string }) {
      planSpy?.(params);
      const next = steps[index] ?? steps[steps.length - 1];
      index += 1;
      if (next.kind === "error") {
        throw next.error;
      }
      return next.value;
    },
    async streamFinalAnswer(params: {
      onText: (chunk: string) => void;
      signal?: AbortSignal;
      instructions: string;
    }) {
      streamSpy?.({ instructions: params.instructions });
      if (streamImpl) {
        await streamImpl(params);
        return;
      }
      params.onText("완료");
    },
  };
}

describe("runAgentTurn", () => {
  it("executes a tool, feeds the result back, and streams a final answer", async () => {
    const harness = createHarness();
    const adapter = createAdapter([
      {
        kind: "step",
        value: {
          type: "tool_call",
          tool: {
            name: "write_file",
            arguments: {
              scope: "sandbox",
              path: "notes.txt",
              content: "hello",
            },
          },
        },
      },
      {
        kind: "step",
        value: { type: "final_answer" },
      },
    ]);

    const result = await runAgentTurn({
      adapter: adapter as never,
      secret: { apiKey: "test" } as never,
      ...harness.baseParams,
    });

    expect(result.assistantText).toBe("완료");
    expect(result.changedFiles).toEqual(["notes.txt"]);
    expect(
      fs.readFileSync(path.join(harness.workspace.getSandboxDir(harness.conversationId), "notes.txt"), "utf8"),
    ).toBe("hello");
    expect(harness.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["tool_call", "tool_result"]),
    );
    expect(harness.finalizations[0]).toMatchObject({
      status: "completed",
      eventType: "run_complete",
    });
  });

  it("retries once after malformed planner output and then completes", async () => {
    const harness = createHarness();
    const adapter = createAdapter([
      {
        kind: "error",
        error: new Error("planner response was not valid JSON"),
      },
      {
        kind: "step",
        value: { type: "final_answer" },
      },
    ]);

    const result = await runAgentTurn({
      adapter: adapter as never,
      secret: { apiKey: "test" } as never,
      ...harness.baseParams,
    });

    expect(result.assistantText).toBe("완료");
    expect(harness.finalizations[0]?.status).toBe("completed");
  });

  it("fails deterministically when malformed planner output still cannot be repaired", async () => {
    const harness = createHarness();
    const adapter = createAdapter([
      {
        kind: "error",
        error: new Error("planner response was not valid JSON"),
      },
      {
        kind: "error",
        error: new Error("planner response was not valid JSON"),
      },
    ]);

    await expect(
      runAgentTurn({
        adapter: adapter as never,
        secret: { apiKey: "test" } as never,
        ...harness.baseParams,
      }),
    ).rejects.toMatchObject({
      status: "failed",
    } satisfies Partial<AgentRunError>);

    expect(harness.finalizations[0]).toMatchObject({
      status: "failed",
      eventType: "run_failed",
    });
  });

  it("falls back to final answer streaming when planner breaks after a successful tool step", async () => {
    const harness = createHarness();
    const adapter = createAdapter([
      {
        kind: "step",
        value: {
          type: "tool_call",
          tool: {
            name: "write_file",
            arguments: {
              scope: "sandbox",
              path: "hello.ts",
              content: "export const ok = true;\n",
            },
          },
        },
      },
      {
        kind: "error",
        error: new Error("planner response was not valid JSON"),
      },
      {
        kind: "error",
        error: new Error("planner response was not valid JSON"),
      },
    ]);

    const result = await runAgentTurn({
      adapter: adapter as never,
      secret: { apiKey: "test" } as never,
      ...harness.baseParams,
    });

    expect(result.assistantText).toBe("완료");
    expect(result.changedFiles).toEqual(["hello.ts"]);
    expect(harness.finalizations[0]).toMatchObject({
      status: "completed",
      eventType: "run_complete",
    });
    expect(harness.sseEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventName: "status",
          payload: expect.objectContaining({
            phase: "planning_fallback_final",
          }),
        }),
      ]),
    );
  });

  it("surfaces invalid tool arguments as explicit error events", async () => {
    const harness = createHarness();
    const adapter = createAdapter([
      {
        kind: "step",
        value: {
          type: "tool_call",
          tool: {
            name: "read_file",
            arguments: {},
          },
        },
      },
    ]);

    await expect(
      runAgentTurn({
        adapter: adapter as never,
        secret: { apiKey: "test" } as never,
        ...harness.baseParams,
      }),
    ).rejects.toMatchObject({
      status: "failed",
    } satisfies Partial<AgentRunError>);

    expect(harness.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "error",
        }),
      ]),
    );
  });

  it("marks step-limit exhaustion as failed instead of silently succeeding", async () => {
    const harness = createHarness();
    const adapter = createAdapter([
      {
        kind: "step",
        value: {
          type: "tool_call",
          tool: {
            name: "list_tree",
            arguments: {
              scope: "sandbox",
            },
          },
        },
      },
    ]);

    await expect(
      runAgentTurn({
        adapter: adapter as never,
        secret: { apiKey: "test" } as never,
        maxSteps: 1,
        ...harness.baseParams,
      }),
    ).rejects.toMatchObject({
      status: "failed",
    } satisfies Partial<AgentRunError>);

    expect(harness.finalizations[0]?.eventType).toBe("run_failed");
  });

  it("fails cleanly when a tool times out", async () => {
    const harness = createHarness();
    const adapter = createAdapter([
      {
        kind: "step",
        value: {
          type: "tool_call",
          tool: {
            name: "exec_command",
            arguments: {
              program: process.execPath,
              args: ["-e", "setTimeout(() => {}, 2000)"],
              timeoutMs: 100,
            },
          },
        },
      },
    ]);

    await expect(
      runAgentTurn({
        adapter: adapter as never,
        secret: { apiKey: "test" } as never,
        ...harness.baseParams,
      }),
    ).rejects.toMatchObject({
      status: "failed",
    } satisfies Partial<AgentRunError>);

    expect(harness.finalizations[0]?.status).toBe("failed");
  });

  it("propagates cancellation into final-answer streaming and finalizes once", async () => {
    const harness = createHarness();
    const adapter = createAdapter(
      [
        {
          kind: "step",
          value: { type: "final_answer" },
        },
      ],
      async ({ signal }) => {
        await new Promise<never>((_, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(signal.reason ?? createAbortError("cancelled")),
            { once: true },
          );
        });
      },
    );

    const controller = new AbortController();
    const pending = runAgentTurn({
      adapter: adapter as never,
      secret: { apiKey: "test" } as never,
      signal: controller.signal,
      ...harness.baseParams,
    });

    setTimeout(() => controller.abort(createAbortError("cancelled")), 50);

    await expect(pending).rejects.toMatchObject({
      status: "cancelled",
    } satisfies Partial<AgentRunError>);
    expect(harness.finalizations).toHaveLength(1);
    expect(harness.finalizations[0]?.eventType).toBe("run_cancelled");
  });

  it("records a planning repair status event before retrying malformed planner JSON", async () => {
    const harness = createHarness();
    const adapter = createAdapter([
      {
        kind: "error",
        error: new Error("planner response was not valid JSON"),
      },
      {
        kind: "step",
        value: { type: "final_answer" },
      },
    ]);

    await runAgentTurn({
      adapter: adapter as never,
      secret: { apiKey: "test" } as never,
      ...harness.baseParams,
    });

    expect(harness.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "status",
          payload: expect.objectContaining({
            phase: "planning_repair",
          }),
        }),
      ]),
    );
  });

  it("keeps strict JSON instructions when a tool registry is active", async () => {
    const harness = createHarness();
    const instructionCalls: string[] = [];
    const finalInstructionCalls: string[] = [];
    const adapter = createAdapter(
      [
        {
          kind: "step",
          value: { type: "final_answer" },
        },
      ],
      undefined,
      ({ instructions }) => {
        instructionCalls.push(instructions);
      },
      ({ instructions }) => {
        finalInstructionCalls.push(instructions);
      },
    );
    const toolRegistry = createToolRegistry();
    registerCoreTools(toolRegistry);

    await runAgentTurn({
      adapter: adapter as never,
      secret: { apiKey: "test" } as never,
      toolRegistry,
      ...harness.baseParams,
    });

    expect(instructionCalls[0]).toContain("Return strict JSON only.");
    expect(instructionCalls[0]).toContain("Registered tools:");
    expect(instructionCalls[0]).toContain("list_tree");
    expect(instructionCalls[0]).toContain("exec_command");
    expect(finalInstructionCalls[0]).toContain("SOUL guidance:");
    expect(finalInstructionCalls[0]).toContain("Runtime context:");
    expect(finalInstructionCalls[0]).toContain("Run mode: foreground");
  });

  it("injects standing orders and persists run phases with checkpoints", async () => {
    const harness = createHarness();
    const agent: AgentRecord = {
      id: "agent-1",
      name: "Standing Orders Agent",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    harness.workspace.writeAgentStandingOrders(
      agent.id,
      "# Standing Orders\n\n- Keep replies concise.\n- Prefer Korean.",
    );

    const planInstructions: string[] = [];
    const adapter = createAdapter(
      [
        {
          kind: "step",
          value: { type: "final_answer" },
        },
      ],
      undefined,
      ({ instructions }) => {
        planInstructions.push(instructions);
      },
    );

    await runAgentTurn({
      agent,
      agentId: agent.id,
      adapter: adapter as never,
      secret: { apiKey: "test" } as never,
      ...harness.baseParams,
    });

    expect(harness.runCreations[0]).toEqual(
      expect.objectContaining({
        phase: "accepted",
        checkpoint: expect.objectContaining({
          stepIndex: 0,
          maxSteps: 8,
          runMode: "foreground",
        }),
      }),
    );
    expect(harness.runPatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "planning",
          checkpoint: expect.objectContaining({
            stepIndex: 0,
            lastToolName: null,
          }),
        }),
        expect.objectContaining({
          phase: "synthesizing",
          checkpoint: expect.objectContaining({
            stepIndex: 8,
            lastToolName: null,
          }),
        }),
      ]),
    );
    expect(planInstructions[0]).toContain("Standing orders:");
    expect(planInstructions[0]).toContain("Prefer Korean");
  });

  it("queues a continuation task for detached runs when the autonomous step budget is exhausted", async () => {
    const harness = createHarness();
    const enqueuedTasks: Array<Record<string, unknown>> = [];
    const taskManager = {
      async enqueueDetachedTask(input: Record<string, unknown>) {
        enqueuedTasks.push(input);
        return { id: "continuation-task" };
      },
    };
    const adapter = createAdapter([
      {
        kind: "step",
        value: {
          type: "tool_call",
          tool: {
            name: "list_tree",
            arguments: {
              scope: "sandbox",
            },
          },
        },
      },
    ]);

    const result = await runAgentTurn({
      adapter: adapter as never,
      secret: { apiKey: "test" } as never,
      taskManager: taskManager as never,
      isDetachedTask: true,
      currentTaskId: "task-1",
      nestingDepth: 0,
      maxSteps: 1,
      ...harness.baseParams,
    });

    expect(result.assistantText).toBe("완료");
    expect(enqueuedTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskKind: "continuation",
          parentTaskId: "task-1",
          nestingDepth: 1,
          startImmediately: true,
        }),
      ]),
    );
    expect(harness.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "status",
          payload: expect.objectContaining({
            phase: "continuation_scheduled",
          }),
        }),
      ]),
    );
  });

  it("limits spawn_task nesting depth to two levels", async () => {
    const harness = createHarness();
    const taskManager = {
      async enqueueDetachedTask() {
        return { id: "task-next" };
      },
    };
    const adapter = createAdapter([
      {
        kind: "step",
        value: {
          type: "tool_call",
          tool: {
            name: "spawn_task",
            arguments: {
              prompt: "Do follow-up work",
            },
          },
        },
      },
    ]);
    const toolRegistry = createToolRegistry();
    registerCoreTools(toolRegistry);

    await expect(
      runAgentTurn({
        adapter: adapter as never,
        secret: { apiKey: "test" } as never,
        toolRegistry,
        taskManager: taskManager as never,
        isDetachedTask: true,
        currentTaskId: "task-parent",
        nestingDepth: 2,
        ...harness.baseParams,
      }),
    ).rejects.toMatchObject({
      status: "failed",
    } satisfies Partial<AgentRunError>);
  });

  it("schedules delayed tasks with schedule_task", async () => {
    const harness = createHarness();
    const enqueueDetachedTask = vi.fn(async (input: Record<string, unknown>) => ({
      id: "scheduled-task",
      input,
    }));
    const taskManager = {
      enqueueDetachedTask,
    };
    const adapter = createAdapter([
      {
        kind: "step",
        value: {
          type: "tool_call",
          tool: {
            name: "schedule_task",
            arguments: {
              title: "Follow up later",
              prompt: "Check back after a little while.",
              delayMs: 60000,
            },
          },
        },
      },
      {
        kind: "step",
        value: { type: "final_answer" },
      },
    ]);
    const toolRegistry = createToolRegistry();
    registerCoreTools(toolRegistry);

    await runAgentTurn({
      adapter: adapter as never,
      secret: { apiKey: "test" } as never,
      toolRegistry,
      taskManager: taskManager as never,
      ...harness.baseParams,
    });

    const call = enqueueDetachedTask.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(call).toEqual(
      expect.objectContaining({
        taskKind: "scheduled",
        startImmediately: false,
        parentTaskId: null,
        nestingDepth: 1,
      }),
    );
    expect(typeof call?.scheduledFor).toBe("number");
  });

  it("rejects exec_command cwd values that escape the sandbox", async () => {
    const harness = createHarness();
    const adapter = createAdapter([
      {
        kind: "step",
        value: {
          type: "tool_call",
          tool: {
            name: "exec_command",
            arguments: {
              program: process.execPath,
              args: ["-e", 'process.stdout.write("ok")'],
              cwd: "../outside",
            },
          },
        },
      },
    ]);

    await expect(
      runAgentTurn({
        adapter: adapter as never,
        secret: { apiKey: "test" } as never,
        ...harness.baseParams,
      }),
    ).rejects.toMatchObject({
      status: "failed",
    } satisfies Partial<AgentRunError>);

    expect(harness.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "error",
          payload: expect.objectContaining({
            phase: "tool",
            tool: "exec_command",
          }),
        }),
      ]),
    );
  });

  it("supports registry-backed memory tools and persists durable memory", async () => {
    const harness = createHarness();
    const adapter = createAdapter([
      {
        kind: "step",
        value: {
          type: "tool_call",
          tool: {
            name: "memory_write",
            arguments: {
              content: "User prefers concise Korean summaries.",
              target: "durable",
            },
          },
        },
      },
      {
        kind: "step",
        value: { type: "final_answer" },
      },
    ]);

    const toolRegistry = createToolRegistry();
    registerCoreTools(toolRegistry);
    const memoryManager = createMemoryManager({
      workspace: harness.workspace,
    });
    const agent: AgentRecord = {
      id: "agent-1",
      name: "Memory Agent",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = await runAgentTurn({
      agent,
      adapter: adapter as never,
      secret: { apiKey: "test" } as never,
      toolRegistry,
      memoryManager,
      agentId: agent.id,
      ...harness.baseParams,
    });

    expect(result.assistantText).toBe("완료");
    const snapshot = memoryManager.getSnapshot(agent.id);
    expect(snapshot.durableMemory).toContain("concise Korean summaries");
    expect(harness.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["tool_call", "tool_result"]),
    );
  });
});
