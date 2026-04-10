import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentTurn, AgentRunError } from "./agent-runtime.js";
import { createAbortError } from "./process-control.js";
import { createWorkspaceManager } from "./workspace.js";
import type {
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
  const sseEvents: Array<{ eventName: string; payload: Record<string, unknown> }> = [];

  const store = {
    createWorkspaceRun() {
      return { id: "run-1" };
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
    async planToolStep() {
      const next = steps[index] ?? steps[steps.length - 1];
      index += 1;
      if (next.kind === "error") {
        throw next.error;
      }
      return next.value;
    },
    async streamFinalAnswer(params: { onText: (chunk: string) => void; signal?: AbortSignal }) {
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
});
