import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelAgentTask,
  cancelSubagentSession,
  cancelTaskFlow,
  createAgentTask,
  createSubagentSession,
  createTaskFlow,
  deleteAgent,
  getAgentMemory,
  getAgentHeartbeat,
  getAgentSoul,
  getAgentStandingOrders,
  getWorkspaceFile,
  getWorkspaceTree,
  listChannels,
  listAgentTasks,
  listHeartbeatLogs,
  listPlatformMetadata,
  listPlugins,
  listSubagentSessions,
  listTaskEvents,
  listTaskFlows,
  listTools,
  listWorkspaceRunEvents,
  saveAgentStandingOrders,
  saveAgentHeartbeat,
  saveAgentSoul,
  searchAgentMemory,
  triggerAgentHeartbeat,
  getTaskFlow,
  streamChat,
  writeAgentMemory,
} from "./api";

function createSseResponse(body: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

describe("api helpers", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses SSE delta and done events", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createSseResponse(
        [
          'event: delta',
          'data: {"delta":"Hello"}',
          "",
          'event: delta',
          'data: {"delta":" world"}',
          "",
          'event: done',
          'data: {"messageId":"assistant-1","runId":"run-1","changedFiles":["notes.md"]}',
          "",
        ].join("\n"),
      ),
    );

    const events: Array<{ event: string; payload: unknown }> = [];

    await streamChat(
      {
        conversationId: "11111111-1111-4111-8111-111111111111",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "high",
        message: "hello",
      },
      (eventName, payload) => {
        events.push({
          event: eventName,
          payload,
        });
      },
    );

    expect(events).toEqual([
      {
        event: "delta",
        payload: { delta: "Hello" },
      },
      {
        event: "delta",
        payload: { delta: " world" },
      },
      {
        event: "done",
        payload: { messageId: "assistant-1", runId: "run-1", changedFiles: ["notes.md"] },
      },
    ]);
  });

  it("includes conversationId when fetching run events", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ events: [] }), {
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    await listWorkspaceRunEvents(
      "11111111-1111-4111-8111-111111111111",
      "run-123",
    );

    expect(fetch).toHaveBeenCalledWith(
      "/api/workspace/runs/run-123/events?conversationId=11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("includes conversationId when fetching workspace tree and file payloads", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ scope: "sandbox", path: ".", tree: [] }), {
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
    await getWorkspaceTree({
      conversationId: "11111111-1111-4111-8111-111111111111",
      scope: "sandbox",
      path: "docs",
      maxDepth: 2,
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/workspace/tree?conversationId=11111111-1111-4111-8111-111111111111&scope=sandbox&path=docs&maxDepth=2",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          file: {
            scope: "sandbox",
            path: "docs/readme.md",
            content: "# readme",
            binary: false,
            unsupportedEncoding: false,
            encoding: "utf-8",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );
    await getWorkspaceFile({
      conversationId: "11111111-1111-4111-8111-111111111111",
      scope: "sandbox",
      path: "docs/readme.md",
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/workspace/file?conversationId=11111111-1111-4111-8111-111111111111&scope=sandbox&path=docs%2Freadme.md",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("uses scoped agent task and memory endpoints", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true, task: {}, tasks: [], events: [], memory: {} }), {
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    await listAgentTasks("agent-1");
    await createAgentTask("agent-1", { prompt: "do work" });
    await cancelAgentTask("agent-1", "task-1");
    await listTaskEvents("agent-1", "task-1");
    await getAgentMemory("agent-1");
    await writeAgentMemory("agent-1", { content: "remember this", target: "durable" });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/agents/agent-1/tasks",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/agents/agent-1/tasks",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/api/agents/agent-1/tasks/task-1/cancel",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "/api/agents/agent-1/tasks/task-1/events",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      "/api/agents/agent-1/memory",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      6,
      "/api/agents/agent-1/memory",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("uses agent soul, heartbeat, trigger, and heartbeat log endpoints", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.endsWith("/soul")) {
        return new Response(
          JSON.stringify({ soul: { path: "SOUL.md", content: "kindness first" } }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      if (url.endsWith("/heartbeat")) {
        return new Response(
          JSON.stringify({
            heartbeat: {
              path: "HEARTBEAT.md",
              content: "enabled: true",
              enabled: true,
              intervalMinutes: 30,
              lastRun: "2026-04-13T00:00:00.000Z",
              instructions: "check in",
              parseError: null,
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      if (url.endsWith("/heartbeat/trigger")) {
        return new Response(
          JSON.stringify({
            message: "triggered",
            log: {
              id: "heartbeat-log-1",
              agentId: "agent-1",
              conversationId: "conversation-1",
              taskId: null,
              triggerSource: "manual",
              status: "queued",
              summary: "Heartbeat queued",
              errorText: null,
              triggeredAt: 123,
              startedAt: null,
              completedAt: null,
              updatedAt: 123,
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      if (url.endsWith("/heartbeat/logs")) {
        return new Response(
          JSON.stringify({
            logs: [
              {
                id: "heartbeat-log-1",
                agentId: "agent-1",
                conversationId: "conversation-1",
                taskId: null,
                triggerSource: "manual",
                status: "completed",
                summary: "done",
                errorText: null,
                triggeredAt: 123,
                startedAt: 124,
                completedAt: 125,
                updatedAt: 125,
              },
            ],
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    await getAgentSoul("agent-1");
    await saveAgentSoul("agent-1", { content: "kindness first" });
    await getAgentHeartbeat("agent-1");
    await saveAgentHeartbeat("agent-1", {
      enabled: true,
      intervalMinutes: 30,
      instructions: "check in",
    });
    await triggerAgentHeartbeat("agent-1");
    await listHeartbeatLogs("agent-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/agents/agent-1/soul",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/agents/agent-1/soul",
      expect.objectContaining({
        method: "PUT",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/api/agents/agent-1/heartbeat",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "/api/agents/agent-1/heartbeat",
      expect.objectContaining({
        method: "PUT",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      "/api/agents/agent-1/heartbeat/trigger",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      6,
      "/api/agents/agent-1/heartbeat/logs",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("uses standing orders, memory search, sub-agent, and task flow endpoints", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = input.toString();
      const method = input instanceof Request ? input.method : "GET";
      if (url.endsWith("/standing-orders")) {
        return new Response(JSON.stringify({ standingOrders: { path: "standing-orders.md", content: "# orders" } }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/memory/search")) {
        return new Response(JSON.stringify({ results: [{ path: "MEMORY.md", excerpt: "keep it short" }] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/subagents")) {
        if (method === "POST") {
          return new Response(JSON.stringify({ session: { id: "sub-1" }, task: { id: "task-1" } }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/sessions/")) {
          return new Response(JSON.stringify({ sessions: [] }), {
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      if (url.endsWith("/flows")) {
        if (method === "POST") {
          return new Response(
            JSON.stringify({
              flow: {
                id: "flow-1",
                agentId: "agent-1",
                conversationId: "conversation-1",
                title: "Flow",
                status: "running",
                createdAt: 1,
                updatedAt: 2,
              },
              steps: [
                {
                  id: "step-1",
                  flowId: "flow-1",
                  stepKey: "step-1",
                  title: "Step 1",
                  prompt: "Do the thing",
                  dependencyStepKey: null,
                  status: "queued",
                  taskId: null,
                  createdAt: 1,
                  updatedAt: 1,
                },
              ],
            }),
            {
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(JSON.stringify({ flows: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/flows/flow-1")) {
        return new Response(
          JSON.stringify({
            flow: {
              id: "flow-1",
              agentId: "agent-1",
              conversationId: "conversation-1",
              title: "Flow",
              status: "running",
              createdAt: 1,
              updatedAt: 2,
            },
            steps: [
              {
                id: "step-1",
                flowId: "flow-1",
                stepKey: "step-1",
                title: "Step 1",
                prompt: "Do the thing",
                dependencyStepKey: null,
                status: "queued",
                taskId: null,
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      if (url.endsWith("/cancel")) {
        return new Response(JSON.stringify({ ok: true, task: null, flow: null }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    await getAgentStandingOrders("agent-1");
    await saveAgentStandingOrders("agent-1", { content: "# orders" });
    await searchAgentMemory("agent-1", { query: "note", maxResults: 5 });
    await listSubagentSessions("conversation-1");
    await createSubagentSession("conversation-1", { prompt: "help me" });
    await cancelSubagentSession("conversation-2");
    await listTaskFlows("agent-1");
    await createTaskFlow("agent-1", {
      conversationId: "conversation-1",
      title: "Flow",
      steps: [{ stepKey: "step-1", title: "Step 1", prompt: "Do the thing" }],
    });
    await getTaskFlow("flow-1");
    await cancelTaskFlow("flow-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/agents/agent-1/standing-orders",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/agents/agent-1/standing-orders",
      expect.objectContaining({
        method: "PUT",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/api/agents/agent-1/memory/search?query=note&maxResults=5",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "/api/sessions/conversation-1/subagents",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      "/api/sessions/conversation-1/subagents",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      6,
      "/api/subagents/conversation-2/cancel",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      7,
      "/api/agents/agent-1/flows",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      8,
      "/api/agents/agent-1/flows",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      9,
      "/api/flows/flow-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      10,
      "/api/flows/flow-1/cancel",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("uses agent delete and platform metadata endpoints", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url === "/api/plugins") {
        return new Response(JSON.stringify({ plugins: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/tools") {
        return new Response(JSON.stringify({ tools: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/channels") {
        return new Response(JSON.stringify({ channels: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    await deleteAgent("agent-1");
    await listPlugins();
    await listTools();
    await listChannels();
    const metadata = await listPlatformMetadata();

    expect(metadata).toEqual({
      plugins: [],
      tools: [],
      channels: [],
      agentSkills: [],
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/agents/agent-1",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/plugins",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/tools",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/channels",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });
});
