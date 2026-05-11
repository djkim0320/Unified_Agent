import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySkillTemplateToHeartbeat,
  applySkillTemplateToStandingOrders,
  cancelAgentTask,
  cancelSubagentSession,
  cancelTaskFlow,
  createAgentAutomationRule,
  createAgentTask,
  createMcpTestRun,
  createSubagentSession,
  createTaskFlow,
  draftFlowFromPrompt,
  deleteAgent,
  deleteAgentAutomationRule,
  deleteTaskFlow,
  getAgentHeartbeat,
  getEngineRun,
  getMcpCatalog,
  getMcpConfigStatus,
  getPreflightStatus,
  getRunDebug,
  getTaskDebug,
  getTokenUsageSummary,
  getAgentSoul,
  getAgentStandingOrders,
  getConversationSummary,
  listChannels,
  listAgentAutomationRules,
  listAgentTasks,
  listHeartbeatLogs,
  listPlatformMetadata,
  listPlugins,
  listRunArtifacts,
  listSkillTemplates,
  listSubagentSessions,
  listTaskEvents,
  listTaskFlows,
  listWorkspaceRunEvents,
  previewArtifact,
  refreshConversationSummary,
  saveAgentStandingOrders,
  saveConversationSummary,
  saveAgentHeartbeat,
  saveAgentSoul,
  saveTaskFlowSteps,
  resumeTaskFlow,
  retryTaskFlowStep,
  skipTaskFlowStep,
  startTaskFlow,
  triggerAgentAutomationRule,
  triggerAgentHeartbeat,
  updateAgentAutomationRule,
  getTaskFlow,
  startOpenCodeAuthLogin,
  streamChat,
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
    globalThis.__LOCAL_API_TOKEN__ = "test-local-token";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    delete globalThis.__LOCAL_API_TOKEN__;
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

  it("includes conversationId when fetching engine run summaries", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ engineRun: { runId: "run-123", engineKind: "opencode" } }), {
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    await getEngineRun("11111111-1111-4111-8111-111111111111", "run-123");

    expect(fetch).toHaveBeenCalledWith(
      "/api/engine/runs/run-123?conversationId=11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("uses flow draft, summary, artifacts, preview, and run debug endpoints", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.includes("/flows/draft")) {
        return new Response(JSON.stringify({ draft: { title: "Draft", steps: [] } }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/summary/refresh")) {
        return new Response(JSON.stringify({ summary: { conversationId: "conversation-1", summary: "fresh" } }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/summary")) {
        return new Response(JSON.stringify({ summary: { conversationId: "conversation-1", summary: "saved" } }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/artifacts") && !url.includes("/preview")) {
        return new Response(JSON.stringify({ artifacts: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/preview")) {
        return new Response(JSON.stringify({ artifact: { id: "artifact-1" }, preview: { content: "ok" } }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/debug")) {
        return new Response(JSON.stringify({ run: { id: "run-1" }, summary: { status: "completed" } }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    await draftFlowFromPrompt("agent-1", { conversationId: "conversation-1", prompt: "make a flow" });
    await getConversationSummary("conversation-1");
    await saveConversationSummary("conversation-1", { summary: "saved" });
    await refreshConversationSummary("conversation-1");
    await listRunArtifacts("conversation-1", "run-1");
    await previewArtifact("artifact-1");
    await getRunDebug("conversation-1", "run-1");
    await getPreflightStatus({ agentId: "agent-1", conversationId: "conversation-1" });
    await getTaskDebug("agent-1", "task-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/agents/agent-1/flows/draft",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/conversations/conversation-1/summary",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/api/conversations/conversation-1/summary",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "/api/conversations/conversation-1/summary/refresh",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      "/api/runs/run-1/artifacts?conversationId=conversation-1",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      6,
      "/api/artifacts/artifact-1/preview",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      7,
      "/api/runs/run-1/debug?conversationId=conversation-1",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      8,
      "/api/preflight?agentId=agent-1&conversationId=conversation-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      9,
      "/api/agents/agent-1/tasks/task-1/debug",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("uses opencode MCP metadata and test-run endpoints", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.includes("/catalog")) {
        return new Response(JSON.stringify({ servers: [], boundary: "opencode only" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/config/status")) {
        return new Response(
          JSON.stringify({
            status: {
              engineAvailable: true,
              configDirSource: "default",
              displayPath: "opencode 기본 설정 경로",
              configuredCount: 0,
              configuredServers: [],
              warnings: [],
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ task: {}, conversation: {}, prompt: "", boundary: "" }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    await getMcpCatalog();
    await getMcpConfigStatus();
    await createMcpTestRun({ agentId: "agent-1", conversationId: "conversation-1", catalogId: "filesystem" });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/mcp/catalog",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/mcp/config/status",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/api/mcp/test-run",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("uses skill template catalog and apply endpoints", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url === "/api/skill-templates") {
        return new Response(JSON.stringify({ templates: [], boundary: "metadata only" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/apply-standing-orders")) {
        return new Response(
          JSON.stringify({
            standingOrders: { path: "STANDING_ORDERS.md", content: "# orders" },
            template: { id: "codebase-review" },
            applied: true,
            message: "ok",
            boundary: "metadata only",
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/apply-heartbeat")) {
        return new Response(
          JSON.stringify({
            heartbeat: {
              path: "HEARTBEAT.md",
              content: "",
              enabled: false,
              intervalMinutes: 60,
              lastRun: null,
              instructions: "review",
              parseError: null,
            },
            template: { id: "codebase-review" },
            applied: true,
            message: "ok",
            boundary: "metadata only",
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    await listSkillTemplates();
    await applySkillTemplateToStandingOrders("agent-1", "codebase-review");
    await applySkillTemplateToHeartbeat("agent-1", "codebase-review");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/skill-templates",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/agents/agent-1/skill-templates/codebase-review/apply-standing-orders",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/api/agents/agent-1/skill-templates/codebase-review/apply-heartbeat",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses scoped agent task endpoints", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true, task: {}, tasks: [], events: [] }), {
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    await listAgentTasks("agent-1");
    await createAgentTask("agent-1", { prompt: "do work" });
    await cancelAgentTask("agent-1", "task-1");
    await listTaskEvents("agent-1", "task-1");

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
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("uses scoped agent automation rule endpoints", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true, rule: {}, rules: [], task: {} }), {
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    await listAgentAutomationRules("agent-1");
    await createAgentAutomationRule("agent-1", {
      title: "Daily sweep",
      prompt: "Summarize state",
      intervalMinutes: 60,
    });
    await updateAgentAutomationRule("agent-1", "rule-1", { enabled: false });
    await triggerAgentAutomationRule("agent-1", "rule-1");
    await deleteAgentAutomationRule("agent-1", "rule-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/agents/agent-1/automation-rules",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/agents/agent-1/automation-rules",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/api/agents/agent-1/automation-rules/rule-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "/api/agents/agent-1/automation-rules/rule-1/trigger",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      "/api/agents/agent-1/automation-rules/rule-1",
      expect.objectContaining({ method: "DELETE" }),
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

  it("uses standing orders, sub-agent, and task flow endpoints", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = input.toString();
      const method = input instanceof Request ? input.method : "GET";
      if (url.endsWith("/standing-orders")) {
        return new Response(JSON.stringify({ standingOrders: { path: "standing-orders.md", content: "# orders" } }), {
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
      if (
        url.endsWith("/flows/flow-1/start") ||
        url.endsWith("/flows/flow-1/resume") ||
        url.endsWith("/flows/flow-1/steps/step-1/retry") ||
        url.endsWith("/flows/flow-1/steps/step-1/skip")
      ) {
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
            steps: [],
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
    await saveTaskFlowSteps("flow-1", [], "Renamed Flow");
    await deleteTaskFlow("flow-1");
    await cancelTaskFlow("flow-1");
    await startTaskFlow("flow-1");
    await resumeTaskFlow("flow-1");
    await retryTaskFlowStep("flow-1", "step-1");
    await skipTaskFlowStep("flow-1", "step-1");

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
      "/api/sessions/conversation-1/subagents",
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
        method: "POST",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      "/api/subagents/conversation-2/cancel",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      6,
      "/api/agents/agent-1/flows",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      7,
      "/api/agents/agent-1/flows",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      8,
      "/api/flows/flow-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      9,
      "/api/flows/flow-1/steps",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ steps: [], title: "Renamed Flow" }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      10,
      "/api/flows/flow-1",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      11,
      "/api/flows/flow-1/cancel",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      12,
      "/api/flows/flow-1/start",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      13,
      "/api/flows/flow-1/resume",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      14,
      "/api/flows/flow-1/steps/step-1/retry",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      15,
      "/api/flows/flow-1/steps/step-1/skip",
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
      if (url === "/api/channels") {
        return new Response(JSON.stringify({ channels: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/usage/tokens") {
        return new Response(JSON.stringify({ usage: { totalTokens: 42, byModel: [] } }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    await deleteAgent("agent-1");
    await listPlugins();
    await listChannels();
    const usage = await getTokenUsageSummary();
    const metadata = await listPlatformMetadata();

    expect(metadata).toEqual({
      plugins: [],
      tools: [],
      channels: [],
      agentSkills: [],
    });
    expect(usage.usage.totalTokens).toBe(42);
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
      "/api/channels",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("starts opencode OAuth login through the API helper", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          launched: false,
          provider: "openai",
          command: "opencode auth login --provider openai",
          message: "ready",
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const result = await startOpenCodeAuthLogin({ provider: "openai", launch: false });

    expect(result.provider).toBe("openai");
    expect(fetch).toHaveBeenCalledWith(
      "/api/engine/opencode/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ provider: "openai", launch: false }),
      }),
    );
  });
});
