import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });
}

function textResponse(body: string, init?: ResponseInit) {
  return new Response(body, init);
}

function sseStreamResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
      },
    },
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFakeJwt(payload: Record<string, unknown>) {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

function createOpenAiResponsesFetchMock() {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url !== "https://api.openai.com/v1/responses") {
      throw new Error(`Unhandled fetch ${url}`);
    }

    const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
    if (body.stream) {
      return textResponse(
        [
          "event: delta",
          'data: {"type":"response.output_text.delta","delta":"done"}',
          "",
          "event: done",
          "data: {}",
          "",
        ].join("\n"),
        {
          headers: {
            "Content-Type": "text/event-stream",
          },
        },
      );
    }

    return jsonResponse({
      output_text: JSON.stringify({
        type: "final_answer",
      }),
    });
  });
}

describe("createApp", () => {
  let dataDir: string;
  let originalCodexHome: string | undefined;
  let openStores: Array<ReturnType<typeof createApp>["store"]>;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-chat-app-"));
    originalCodexHome = process.env.CODEX_HOME;
    openStores = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const store of openStores) {
      try {
        store.rawDb.close();
      } catch {
        // Ignore double-close scenarios in tests.
      }
    }
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("stores API-key providers encrypted at rest", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const saveResponse = await request(app)
      .put("/api/providers/openai/account")
      .send({ apiKey: "sk-test-123" });

    expect(saveResponse.status).toBe(200);

    const providersResponse = await request(app).get("/api/providers");
    expect(providersResponse.status).toBe(200);
    expect(providersResponse.body.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "openai",
          configured: true,
          status: "configured",
        }),
      ]),
    );

    const row = store.rawDb
      .prepare("SELECT encrypted_blob FROM provider_secrets WHERE provider_kind = ?")
      .get("openai") as { encrypted_blob: string };

    expect(row.encrypted_blob).toBeTruthy();
    expect(row.encrypted_blob).not.toContain("sk-test-123");
  });

  it("returns curated model picks even before providers are configured", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const openaiResponse = await request(app).get("/api/providers/openai/models");
    expect(openaiResponse.status).toBe(200);
    expect(openaiResponse.body.models).toEqual(["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"]);

    const anthropicResponse = await request(app).get("/api/providers/anthropic/models");
    expect(anthropicResponse.status).toBe(200);
    expect(anthropicResponse.body.models).toEqual([
      "claude-sonnet-4-6",
      "claude-opus-4-6",
      "claude-haiku-4-5",
    ]);

    const geminiResponse = await request(app).get("/api/providers/gemini/models");
    expect(geminiResponse.status).toBe(200);
    expect(geminiResponse.body.models).toEqual([
      "gemini-3-flash-preview",
      "gemini-3.1-pro-preview",
      "gemini-3.1-flash-lite-preview",
    ]);
  });

  it("exposes normalized channels, plugin manifests, and agent skill summaries", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const toolsResponse = await request(app).get("/api/tools");
    expect(toolsResponse.status).toBe(200);
    expect(toolsResponse.body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "list_tree",
          description: "List files and folders in a workspace scope.",
          permission: "workspace",
          audit: expect.objectContaining({
            category: "unknown",
            safeByDefault: true,
          }),
        }),
      ]),
    );
    expect(JSON.stringify(toolsResponse.body)).not.toContain("execute");

    const channelsResponse = await request(app).get("/api/channels");
    expect(channelsResponse.status).toBe(200);
    expect(channelsResponse.body.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "webchat",
          label: "Web Chat",
          enabled: true,
          description: "Browser-based local chat channel.",
          note: "Primary channel for local conversations.",
        }),
      ]),
    );

    const pluginsResponse = await request(app).get("/api/plugins");
    expect(pluginsResponse.status).toBe(200);
    expect(pluginsResponse.body.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "core",
          name: "Core Tools",
          description: "Built-in workspace, research, memory, task, and execution tools.",
          tools: expect.arrayContaining(["list_tree", "exec_command", "spawn_task"]),
          skills: expect.arrayContaining([
            expect.objectContaining({
              name: "workspace-runtime",
              summary: expect.stringContaining("Core runtime guidance"),
            }),
          ]),
        }),
      ]),
    );
    expect(JSON.stringify(pluginsResponse.body)).not.toContain("Use the sandbox files");

    const skillsResponse = await request(app).get("/api/agents/default-agent/skills");
    expect(skillsResponse.status).toBe(200);
    expect(skillsResponse.body.agentId).toBe("default-agent");
    expect(skillsResponse.body.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "plugin",
          name: "workspace-runtime",
          summary: expect.stringContaining("Core runtime guidance"),
        }),
      ]),
    );
    expect(JSON.stringify(skillsResponse.body)).not.toContain("Use the sandbox files");
  });

  it("creates agents, scopes sessions, and exposes explicit memory files", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const createAgentResponse = await request(app)
      .post("/api/agents")
      .send({
        name: "Research Agent",
        providerKind: "anthropic",
        model: "claude-sonnet-4-6",
        reasoningLevel: "medium",
      });
    expect(createAgentResponse.status).toBe(200);
    const agentId = createAgentResponse.body.agent.id as string;

    const createSessionResponse = await request(app)
      .post("/api/conversations")
      .send({
        agentId,
        title: "Research session",
        providerKind: "anthropic",
        model: "claude-sonnet-4-6",
        reasoningLevel: "medium",
      });
    expect(createSessionResponse.status).toBe(200);
    expect(createSessionResponse.body.conversation.agentId).toBe(agentId);

    const defaultSessionsResponse = await request(app).get("/api/conversations?agentId=default-agent");
    expect(defaultSessionsResponse.status).toBe(200);
    expect(defaultSessionsResponse.body.conversations).toEqual([]);

    const agentSessionsResponse = await request(app).get(`/api/conversations?agentId=${agentId}`);
    expect(agentSessionsResponse.status).toBe(200);
    expect(agentSessionsResponse.body.conversations).toHaveLength(1);

    const writeMemoryResponse = await request(app)
      .post(`/api/agents/${agentId}/memory`)
      .send({ content: "User prefers research summaries in Korean.", target: "durable" });
    expect(writeMemoryResponse.status).toBe(200);
    expect(writeMemoryResponse.body.memory.durableMemory).toContain("Korean");

    const memoryResponse = await request(app).get(`/api/agents/${agentId}/memory`);
    expect(memoryResponse.status).toBe(200);
    expect(memoryResponse.body.memory.durableMemoryPath).toBe("MEMORY.md");
    expect(JSON.stringify(memoryResponse.body)).not.toContain(dataDir);

    const memorySearchResponse = await request(app).get(
      `/api/agents/${agentId}/memory/search?query=${encodeURIComponent("Korean summaries")}&maxResults=5`,
    );
    expect(memorySearchResponse.status).toBe(200);
    expect(memorySearchResponse.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "MEMORY.md",
          kind: "durable",
        }),
      ]),
    );
  });

  it("exposes soul and heartbeat routes and records manual heartbeat triggers", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const createAgentResponse = await request(app)
      .post("/api/agents")
      .send({
        name: "Heartbeat Agent",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "high",
      });
    expect(createAgentResponse.status).toBe(200);
    const agentId = createAgentResponse.body.agent.id as string;

    const soulResponse = await request(app).get(`/api/agents/${agentId}/soul`);
    expect(soulResponse.status).toBe(200);
    expect(soulResponse.body.soul).toEqual(
      expect.objectContaining({
        path: "SOUL.md",
        content: expect.stringContaining("# SOUL"),
      }),
    );

    const writeSoulResponse = await request(app)
      .put(`/api/agents/${agentId}/soul`)
      .send({ content: "# SOUL\n\nKeep it simple." });
    expect(writeSoulResponse.status).toBe(200);
    expect(writeSoulResponse.body.soul.content).toContain("Keep it simple.");

    const heartbeatResponse = await request(app).get(`/api/agents/${agentId}/heartbeat`);
    expect(heartbeatResponse.status).toBe(200);
    expect(heartbeatResponse.body.heartbeat).toEqual(
      expect.objectContaining({
        path: "HEARTBEAT.md",
        enabled: false,
        intervalMinutes: 60,
        lastRun: null,
      }),
    );

    const writeHeartbeatResponse = await request(app)
      .put(`/api/agents/${agentId}/heartbeat`)
      .send({
        enabled: true,
        intervalMinutes: 15,
        lastRun: null,
        instructions: "Check inbox and summarize changes.",
      });
    expect(writeHeartbeatResponse.status).toBe(200);
    expect(writeHeartbeatResponse.body.heartbeat).toEqual(
      expect.objectContaining({
        enabled: true,
        intervalMinutes: 15,
        instructions: "Check inbox and summarize changes.",
      }),
    );

    const triggerResponse = await request(app).post(`/api/agents/${agentId}/heartbeat/trigger`);
    expect(triggerResponse.status).toBe(200);
    expect(triggerResponse.body.task).toEqual(
      expect.objectContaining({
        taskKind: "heartbeat",
        title: `Heartbeat: Heartbeat Agent`,
        parentTaskId: null,
      }),
    );
    expect(triggerResponse.body.heartbeatLog).toEqual(
      expect.objectContaining({
        agentId,
        triggerSource: "manual",
        status: "queued",
        taskId: triggerResponse.body.task.id,
      }),
    );
    expect(triggerResponse.body.heartbeat.lastRun).toBeTruthy();

    const logsResponse = await request(app).get(`/api/agents/${agentId}/heartbeat/logs`);
    expect(logsResponse.status).toBe(200);
    expect(logsResponse.body.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: triggerResponse.body.task.id,
          triggerSource: "manual",
        }),
      ]),
    );
    expect(JSON.stringify(logsResponse.body)).not.toContain(dataDir);
  });

  it("manages standing orders, sub-agent sessions, task flows, and run control routes", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const agent = store.saveAgent({
      name: "Coordinator",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });
    const conversation = store.saveConversation({
      agentId: agent.id,
      title: "Parent session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });
    const parentRun = store.createWorkspaceRun({
      conversationId: conversation.id,
      providerKind: conversation.providerKind,
      model: conversation.model,
      userMessage: "Coordinate work",
    });

    const getStandingOrdersResponse = await request(app).get(
      `/api/agents/${agent.id}/standing-orders`,
    );
    expect(getStandingOrdersResponse.status).toBe(200);
    expect(getStandingOrdersResponse.body.standingOrders.path).toBe("STANDING_ORDERS.md");

    const putStandingOrdersResponse = await request(app)
      .put(`/api/agents/${agent.id}/standing-orders`)
      .send({ content: "# Standing Orders\n\nAlways summarize child work clearly." });
    expect(putStandingOrdersResponse.status).toBe(200);
    expect(putStandingOrdersResponse.body.standingOrders.content).toContain("summarize child work");

    const createSubagentResponse = await request(app)
      .post(`/api/sessions/${conversation.id}/subagents`)
      .send({
        title: "Investigate tests",
        prompt: "Inspect the test failures and summarize them.",
      });
    expect(createSubagentResponse.status).toBe(200);
    expect(createSubagentResponse.body.session).toEqual(
      expect.objectContaining({
        sessionKind: "subagent",
        parentConversationId: conversation.id,
        ownerRunId: parentRun.id,
      }),
    );

    const listSubagentsResponse = await request(app).get(`/api/sessions/${conversation.id}/subagents`);
    expect(listSubagentsResponse.status).toBe(200);
    expect(listSubagentsResponse.body.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createSubagentResponse.body.session.id,
          sessionKind: "subagent",
        }),
      ]),
    );

    const createFlowResponse = await request(app)
      .post(`/api/agents/${agent.id}/flows`)
      .send({
        conversationId: conversation.id,
        title: "Patch flow",
        steps: [
          {
            stepKey: "inspect",
            title: "Inspect",
            prompt: "Inspect the current state.",
          },
          {
            stepKey: "summarize",
            title: "Summarize",
            prompt: "Summarize the inspection.",
            dependencyStepKey: "inspect",
          },
        ],
      });
    expect(createFlowResponse.status).toBe(200);
    expect(createFlowResponse.body.flow).toEqual(
      expect.objectContaining({
        agentId: agent.id,
        conversationId: conversation.id,
        title: "Patch flow",
      }),
    );
    expect(createFlowResponse.body.steps).toHaveLength(2);

    const getFlowResponse = await request(app).get(`/api/flows/${createFlowResponse.body.flow.id}`);
    expect(getFlowResponse.status).toBe(200);
    expect(getFlowResponse.body.steps).toHaveLength(2);

    const cancelFlowResponse = await request(app).post(
      `/api/flows/${createFlowResponse.body.flow.id}/cancel`,
    );
    expect(cancelFlowResponse.status).toBe(200);
    expect(cancelFlowResponse.body.flow).toEqual(
      expect.objectContaining({
        id: createFlowResponse.body.flow.id,
      }),
    );

    const detachedTask = store.createTask({
      agentId: agent.id,
      conversationId: conversation.id,
      title: "Later",
      prompt: "Finish later",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
      taskKind: "scheduled",
      scheduledFor: Date.now() + 60_000,
    });
    const taskBackedRun = store.createWorkspaceRun({
      conversationId: conversation.id,
      taskId: detachedTask.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "Resume later",
      phase: "planning",
      checkpoint: {
        stepIndex: 1,
        maxSteps: 8,
        userMessage: "Resume later",
        toolHistory: [],
        changedFiles: [],
        runMode: "foreground",
        lastToolName: null,
      },
    });

    const getRunResponse = await request(app).get(`/api/runs/${taskBackedRun.id}`);
    expect(getRunResponse.status).toBe(200);
    expect(getRunResponse.body.run).toEqual(
      expect.objectContaining({
        id: taskBackedRun.id,
        taskId: detachedTask.id,
        phase: "planning",
      }),
    );

    const cancelRunResponse = await request(app).post(`/api/runs/${taskBackedRun.id}/cancel`);
    expect(cancelRunResponse.status).toBe(200);
    expect(cancelRunResponse.body.task).toEqual(
      expect.objectContaining({
        id: detachedTask.id,
      }),
    );

    const resumableRun = store.createWorkspaceRun({
      conversationId: conversation.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "Pick this back up",
      phase: "planning",
      checkpoint: {
        stepIndex: 2,
        maxSteps: 8,
        userMessage: "Pick this back up",
        toolHistory: [{ tool: "list_tree", result: "[]" }],
        changedFiles: [],
        runMode: "foreground",
        lastToolName: "list_tree",
      },
    });
    store.completeWorkspaceRun(resumableRun.id, "failed");

    const resumeRunResponse = await request(app).post(`/api/runs/${resumableRun.id}/resume`);
    expect(resumeRunResponse.status).toBe(200);
    expect(resumeRunResponse.body.task).toEqual(
      expect.objectContaining({
        taskKind: "continuation",
        originRunId: resumableRun.id,
      }),
    );
  });

  it("records detached task lifecycle and enforces task-event ownership", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const owner = store.saveAgent({
      name: "Owner",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });
    const other = store.saveAgent({
      name: "Other",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });
    const conversation = store.saveConversation({
      agentId: owner.id,
      title: "Task session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });

    const createTaskResponse = await request(app)
      .post(`/api/agents/${owner.id}/tasks`)
      .send({
        conversationId: conversation.id,
        title: "Queued work",
        prompt: "Summarize this later",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "high",
        autoStart: false,
      });
    expect(createTaskResponse.status).toBe(200);
    const taskId = createTaskResponse.body.task.id as string;
    expect(createTaskResponse.body.task.status).toBe("queued");

    const wrongEventsResponse = await request(app).get(`/api/agents/${other.id}/tasks/${taskId}/events`);
    expect(wrongEventsResponse.status).toBe(404);

    const cancelResponse = await request(app).post(`/api/agents/${owner.id}/tasks/${taskId}/cancel`);
    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.task.status).toBe("cancelled");

    const eventsResponse = await request(app).get(`/api/agents/${owner.id}/tasks/${taskId}/events`);
    expect(eventsResponse.status).toBe(200);
    expect(eventsResponse.body.events.map((event: { eventType: string }) => event.eventType)).toEqual(
      expect.arrayContaining(["queued", "cancelled"]),
    );
  });

  it("starts and completes the Codex OAuth callback flow", async () => {
    const accessToken = createFakeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      "https://api.openai.com/profile": {
        email: "codex@example.com",
      },
      "https://api.openai.com/auth": {
        chatgpt_account_user_id: "acct_123",
      },
    });

    const tokenFetch = vi.fn(async () =>
      jsonResponse({
        access_token: accessToken,
        refresh_token: "refresh-token",
        expires_in: 3600,
      }),
    );

    const { app, store } = createApp({
      dataDir,
      projectRoot: dataDir,
      port: 8878,
      fetchImpl: tokenFetch as typeof fetch,
    });
    openStores.push(store);

    const startResponse = await request(app)
      .post("/api/providers/openai-codex/oauth/start")
      .send({ frontendOrigin: "http://127.0.0.1:5173" });

    expect(startResponse.status).toBe(200);
    const authUrl = new URL(startResponse.body.authUrl);
    const state = authUrl.searchParams.get("state");
    expect(state).toBeTruthy();

    const callbackResponse = await request(app).get(
      `/api/providers/openai-codex/oauth/callback?state=${state}&code=auth-code`,
    );

    expect(callbackResponse.status).toBe(200);
    expect(callbackResponse.text).toContain("Codex account connected successfully.");

    const providersResponse = await request(app).get("/api/providers");
    expect(providersResponse.body.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "openai-codex",
          configured: true,
          status: "connected",
          email: "codex@example.com",
          accountId: "acct_123",
        }),
      ]),
    );

    const row = store.rawDb
      .prepare("SELECT encrypted_blob FROM provider_secrets WHERE provider_kind = ?")
      .get("openai-codex") as { encrypted_blob: string };
    expect(row.encrypted_blob).not.toContain(accessToken);
    expect(tokenFetch).toHaveBeenCalledTimes(1);

    const debugResponse = await request(app).get("/api/providers/openai-codex/debug/logs");
    expect(debugResponse.status).toBe(200);
    expect(debugResponse.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "oauth_start",
        }),
        expect.objectContaining({
          event: "oauth_callback_received",
        }),
        expect.objectContaining({
          event: "oauth_token_exchange_succeeded",
        }),
      ]),
    );
    expect(JSON.stringify(debugResponse.body.entries)).not.toContain("auth-code");
    expect(JSON.stringify(debugResponse.body.entries)).not.toContain(accessToken);
  });

  it("imports Codex CLI auth from CODEX_HOME and rejects missing files", async () => {
    const codexHome = path.join(dataDir, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    process.env.CODEX_HOME = codexHome;

    const accessToken = createFakeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      "https://api.openai.com/profile": {
        email: "cli@example.com",
      },
      "https://api.openai.com/auth": {
        chatgpt_account_user_id: "acct_cli",
      },
    });

    fs.writeFileSync(
      path.join(codexHome, "auth.json"),
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: accessToken,
          refresh_token: "cli-refresh",
          account_id: "acct_cli",
        },
      }),
    );

    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const importResponse = await request(app).post("/api/providers/openai-codex/import-cli-auth");
    expect(importResponse.status).toBe(200);
    expect(importResponse.body.provider).toEqual(
      expect.objectContaining({
        kind: "openai-codex",
        status: "connected",
        email: "cli@example.com",
      }),
    );

    const storedSecret = store.rawDb
      .prepare("SELECT encrypted_blob FROM provider_secrets WHERE provider_kind = ?")
      .get("openai-codex") as { encrypted_blob: string };
    expect(storedSecret.encrypted_blob).not.toContain("cli-refresh");

    fs.unlinkSync(path.join(codexHome, "auth.json"));
    const missingResponse = await request(app).post("/api/providers/openai-codex/import-cli-auth");
    expect(missingResponse.status).toBe(400);
    expect(missingResponse.body.error).toContain("Codex auth file not found");
  });

  it("streams chat responses, persists reasoning level, and stores both sides", async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "https://api.openai.com/v1/responses") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };

        if (body.stream) {
          return textResponse(
            [
              'event: delta',
              'data: {"type":"response.output_text.delta","delta":"Hello"}',
              "",
              'event: delta',
              'data: {"type":"response.output_text.delta","delta":" world"}',
              "",
              'event: done',
              'data: {}',
              "",
            ].join("\n"),
            {
              headers: {
                "Content-Type": "text/event-stream",
              },
            },
          );
        }

        return jsonResponse({
          output_text: JSON.stringify({
            type: "final_answer",
          }),
        });
      }

      throw new Error(`Unhandled fetch ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    await request(app).put("/api/providers/openai/account").send({ apiKey: "sk-stream" });
    const createConversationResponse = await request(app)
      .post("/api/conversations")
      .send({
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "high",
      });

    const conversationId = createConversationResponse.body.conversation.id as string;

    const streamResponse = await request(app)
      .post("/api/chat/stream")
      .send({
        conversationId,
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "high",
        message: "Say hi",
      });

    expect(streamResponse.status).toBe(200);
    expect(streamResponse.text).toContain("event: run_complete");
    expect(streamResponse.text).toContain("event: delta");
    expect(streamResponse.text).toContain('"delta":"Hello"');
    expect(streamResponse.text).toContain("event: done");

    const messagesResponse = await request(app).get(`/api/conversations/${conversationId}/messages`);

    expect(messagesResponse.body.messages).toHaveLength(2);
    expect(messagesResponse.body.messages[0]).toEqual(
      expect.objectContaining({
        role: "user",
        content: "Say hi",
      }),
    );
    expect(messagesResponse.body.messages[1]).toEqual(
      expect.objectContaining({
        role: "assistant",
        content: "Hello world",
      }),
    );
    expect(messagesResponse.body.conversation.title).toBe("Say hi");
    expect(messagesResponse.body.conversation.reasoningLevel).toBe("high");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("deletes a conversation and cascades its messages", async () => {
    const { app, store, workspace } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const createConversationResponse = await request(app)
      .post("/api/conversations")
      .send({
        title: "Test chat",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "high",
      });

    const conversationId = createConversationResponse.body.conversation.id as string;

    store.appendMessage({
      conversationId,
      role: "user",
      content: "hello",
    });
    const run = store.createWorkspaceRun({
      conversationId,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "hello",
    });
    store.appendWorkspaceRunEvent({
      runId: run.id,
      eventType: "tool_call",
      payload: { tool: "list_tree" },
    });
    workspace.writeFile({
      conversationId,
      scope: "sandbox",
      relativePath: "notes.txt",
      content: "hello",
    });

    const deleteResponse = await request(app).delete(`/api/conversations/${conversationId}`);
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toEqual({ ok: true });
    expect(store.getConversation(conversationId)).toBeNull();
    expect(store.listMessages(conversationId)).toEqual([]);
    expect(store.listWorkspaceRuns(conversationId)).toEqual([]);
    expect(
      store.rawDb
        .prepare("SELECT COUNT(*) as count FROM workspace_run_events WHERE run_id = ?")
        .get(run.id),
    ).toEqual({ count: 0 });
    expect(fs.existsSync(path.join(workspace.conversationsDir, conversationId))).toBe(false);
  });

  it("does not expose absolute workspace paths and disables root scope by default", async () => {
    const { app, store, workspace } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const createConversationResponse = await request(app)
      .post("/api/conversations")
      .send({
        title: "Workspace",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "medium",
      });
    const conversationId = createConversationResponse.body.conversation.id as string;
    workspace.writeFile({
      conversationId,
      scope: "sandbox",
      relativePath: "메모.txt",
      content: "한글",
    });

    const treeResponse = await request(app).get(
      `/api/workspace/tree?conversationId=${conversationId}&scope=sandbox`,
    );
    expect(treeResponse.status).toBe(200);
    expect(JSON.stringify(treeResponse.body)).not.toContain(dataDir);
    expect(treeResponse.body.workspaceRoot).toBeUndefined();

    const fileResponse = await request(app).get(
      `/api/workspace/file?conversationId=${conversationId}&scope=sandbox&path=${encodeURIComponent("메모.txt")}`,
    );
    expect(fileResponse.status).toBe(200);
    expect(fileResponse.body.file.absolutePath).toBeUndefined();
    expect(fileResponse.body.file.content).toBe("한글");

    const rootResponse = await request(app).get(
      `/api/workspace/tree?conversationId=${conversationId}&scope=root`,
    );
    expect(rootResponse.status).toBe(400);
    expect(rootResponse.body.error).toContain("Root workspace scope is disabled");
  });

  it("exposes absolute workspace paths only when debug paths are enabled", async () => {
    const previous = process.env.ENABLE_WORKSPACE_DEBUG_PATHS;
    process.env.ENABLE_WORKSPACE_DEBUG_PATHS = "true";

    try {
      const { app, store, workspace } = createApp({ dataDir, projectRoot: dataDir });
      openStores.push(store);

      const createConversationResponse = await request(app)
        .post("/api/conversations")
        .send({
          title: "Workspace",
          providerKind: "openai",
          model: "gpt-5.4",
          reasoningLevel: "medium",
        });
      const conversationId = createConversationResponse.body.conversation.id as string;
      workspace.writeFile({
        conversationId,
        scope: "sandbox",
        relativePath: "notes.txt",
        content: "hello",
      });

      const treeResponse = await request(app).get(
        `/api/workspace/tree?conversationId=${conversationId}&scope=sandbox`,
      );
      expect(treeResponse.status).toBe(200);
      expect(treeResponse.body.debug.workspaceRoot).toContain(
        path.join("workspace", "agents", "default-agent", "sessions"),
      );
      expect(treeResponse.body.debug.absolutePath).toContain(conversationId);

      const fileResponse = await request(app).get(
        `/api/workspace/file?conversationId=${conversationId}&scope=sandbox&path=notes.txt`,
      );
      expect(fileResponse.status).toBe(200);
      expect(fileResponse.body.file.absolutePath).toContain(
        path.join("workspace", "agents", "default-agent", "sessions"),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.ENABLE_WORKSPACE_DEBUG_PATHS;
      } else {
        process.env.ENABLE_WORKSPACE_DEBUG_PATHS = previous;
      }
    }
  });

  it("requires conversation ownership when reading run events", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const first = store.saveConversation({
      title: "first",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const second = store.saveConversation({
      title: "second",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const run = store.createWorkspaceRun({
      conversationId: first.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "hello",
    });

    const wrongResponse = await request(app).get(
      `/api/workspace/runs/${run.id}/events?conversationId=${second.id}`,
    );
    expect(wrongResponse.status).toBe(404);

    const rightResponse = await request(app).get(
      `/api/workspace/runs/${run.id}/events?conversationId=${first.id}`,
    );
    expect(rightResponse.status).toBe(200);
    expect(rightResponse.body.events.length).toBeGreaterThan(0);
  });

  it("reads standing orders, searches agent memory, and lists sub-agent sessions", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const standingOrdersResponse = await request(app)
      .put("/api/agents/default-agent/standing-orders")
      .send({ content: "# Standing Orders\n\n- Keep replies concise.\n- Cite workspace state." });
    expect(standingOrdersResponse.status).toBe(200);
    expect(standingOrdersResponse.body.standingOrders).toEqual(
      expect.objectContaining({
        path: "STANDING_ORDERS.md",
        content: expect.stringContaining("Keep replies concise"),
      }),
    );

    const standingOrdersGetResponse = await request(app).get("/api/agents/default-agent/standing-orders");
    expect(standingOrdersGetResponse.status).toBe(200);
    expect(standingOrdersGetResponse.body.standingOrders.content).toContain("Cite workspace state");

    const memoryWriteResponse = await request(app)
      .post("/api/agents/default-agent/memory")
      .send({ content: "User prefers Korean summaries.", target: "durable" });
    expect(memoryWriteResponse.status).toBe(200);

    const memorySearchResponse = await request(app).get(
      "/api/agents/default-agent/memory/search?query=Korean&maxResults=5",
    );
    expect(memorySearchResponse.status).toBe(200);
    expect(memorySearchResponse.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "MEMORY.md",
          text: expect.stringContaining("Korean"),
        }),
      ]),
    );

    const parentConversation = store.saveConversation({
      title: "Parent session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const childConversation = store.saveConversation({
      agentId: parentConversation.agentId,
      title: "Child session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
      sessionKind: "subagent",
      parentConversationId: parentConversation.id,
      ownerRunId: "run-123",
    });

    const subagentSessionsResponse = await request(app).get(
      `/api/sessions/${parentConversation.id}/subagents`,
    );
    expect(subagentSessionsResponse.status).toBe(200);
    expect(subagentSessionsResponse.body.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: childConversation.id,
          sessionKind: "subagent",
          parentConversationId: parentConversation.id,
        }),
      ]),
    );
  });

  it("creates flows, exposes them through the flow APIs, and lets them complete", async () => {
    const fetchMock = createOpenAiResponsesFetchMock();
    const { app, store } = createApp({
      dataDir,
      projectRoot: dataDir,
      fetchImpl: fetchMock as typeof fetch,
    });
    openStores.push(store);

    await request(app).put("/api/providers/openai/account").send({ apiKey: "sk-flow" });
    const conversationResponse = await request(app)
      .post("/api/conversations")
      .send({
        title: "Flow session",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "medium",
      });
    const conversationId = conversationResponse.body.conversation.id as string;

    const createFlowResponse = await request(app)
      .post("/api/agents/default-agent/flows")
      .send({
        conversationId,
        title: "Ship patch",
        steps: [
          {
            stepKey: "inspect",
            title: "Inspect repo",
            prompt: "Inspect the repo and report the current state.",
          },
        ],
      });

    expect(createFlowResponse.status).toBe(200);
    const flowId = createFlowResponse.body.flow.id as string;
    expect(createFlowResponse.body.steps).toHaveLength(1);

    await vi.waitFor(() => {
      expect(store.getTaskFlow(flowId)?.status).toBe("completed");
    });

    const agentFlowsResponse = await request(app).get("/api/agents/default-agent/flows");
    expect(agentFlowsResponse.status).toBe(200);
    expect(agentFlowsResponse.body.flows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: flowId,
          status: "completed",
        }),
      ]),
    );

    const flowResponse = await request(app).get(`/api/flows/${flowId}`);
    expect(flowResponse.status).toBe(200);
    expect(flowResponse.body.flow).toEqual(
      expect.objectContaining({
        id: flowId,
        status: "completed",
      }),
    );
    expect(flowResponse.body.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepKey: "inspect",
          status: "completed",
        }),
      ]),
    );
  });

  it("returns run details, cancels task-backed runs, and resumes from checkpoints", async () => {
    const fetchMock = createOpenAiResponsesFetchMock();
    const { app, store } = createApp({
      dataDir,
      projectRoot: dataDir,
      fetchImpl: fetchMock as typeof fetch,
    });
    openStores.push(store);

    await request(app).put("/api/providers/openai/account").send({ apiKey: "sk-run" });

    const cancelConversation = store.saveConversation({
      title: "Cancel session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const cancelTask = store.createTask({
      agentId: cancelConversation.agentId,
      conversationId: cancelConversation.id,
      title: "Queued work",
      prompt: "Do this later",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const cancelRun = store.createWorkspaceRun({
      conversationId: cancelConversation.id,
      taskId: cancelTask.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "Do this later",
      checkpoint: {
        stepIndex: 0,
        maxSteps: 4,
        userMessage: "Do this later",
        toolHistory: [],
        changedFiles: [],
        runMode: "foreground",
        lastToolName: null,
      },
    });

    const runResponse = await request(app).get(`/api/runs/${cancelRun.id}`);
    expect(runResponse.status).toBe(200);
    expect(runResponse.body.run).toEqual(
      expect.objectContaining({
        id: cancelRun.id,
        taskId: cancelTask.id,
      }),
    );

    const cancelResponse = await request(app).post(`/api/runs/${cancelRun.id}/cancel`);
    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.task.status).toBe("cancelled");

    const resumeConversation = store.saveConversation({
      title: "Resume session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const resumeRun = store.createWorkspaceRun({
      conversationId: resumeConversation.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "Finish the draft",
      checkpoint: {
        stepIndex: 2,
        maxSteps: 4,
        userMessage: "Finish the draft",
        toolHistory: [
          {
            tool: "list_tree",
            result: "workspace listed",
          },
        ],
        changedFiles: ["notes.txt"],
        runMode: "foreground",
        lastToolName: "list_tree",
      },
    });
    store.finalizeWorkspaceRun(resumeRun.id, "failed", "run_failed", { error: "boom" });

    const resumeResponse = await request(app).post(`/api/runs/${resumeRun.id}/resume`);
    expect(resumeResponse.status).toBe(200);
    expect(resumeResponse.body.task).toEqual(
      expect.objectContaining({
        taskKind: "continuation",
        originRunId: resumeRun.id,
      }),
    );

    await vi.waitFor(() => {
      expect(store.getTask(resumeResponse.body.task.id)?.status).toBe("completed");
    });
  });

  it("spawns sub-agent sessions and records their completion in the parent session", async () => {
    const fetchMock = createOpenAiResponsesFetchMock();
    const { app, store } = createApp({
      dataDir,
      projectRoot: dataDir,
      fetchImpl: fetchMock as typeof fetch,
    });
    openStores.push(store);

    await request(app).put("/api/providers/openai/account").send({ apiKey: "sk-subagent" });

    const parentConversation = store.saveConversation({
      title: "Parent session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const parentRun = store.createWorkspaceRun({
      conversationId: parentConversation.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "Investigate the repo",
    });

    const spawnResponse = await request(app)
      .post(`/api/sessions/${parentConversation.id}/subagents`)
      .send({
        title: "Investigate tests",
        prompt: "Inspect the failing tests and summarize the root cause.",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "medium",
      });

    expect(spawnResponse.status).toBe(200);
    expect(spawnResponse.body.session).toEqual(
      expect.objectContaining({
        sessionKind: "subagent",
        parentConversationId: parentConversation.id,
        ownerRunId: parentRun.id,
      }),
    );

    await vi.waitFor(() => {
      const childMessages = store.listMessages(parentConversation.id);
      expect(childMessages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            content: expect.stringContaining("[Sub-agent complete:"),
          }),
        ]),
      );
    });

    const cancelConversation = store.saveConversation({
      agentId: parentConversation.agentId,
      title: "Idle subagent",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
      sessionKind: "subagent",
      parentConversationId: parentConversation.id,
      ownerRunId: parentRun.id,
    });
    const cancelResponse = await request(app).post(`/api/subagents/${cancelConversation.id}/cancel`);
    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body).toEqual({ ok: true, task: null });
  });

  it("marks a streamed run cancelled when the client disconnects", async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url !== "https://api.openai.com/v1/responses") {
        throw new Error(`Unhandled fetch ${url}`);
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (!body.stream) {
        return jsonResponse({
          output_text: JSON.stringify({ type: "final_answer" }),
        });
      }

      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);
    await request(app).put("/api/providers/openai/account").send({ apiKey: "sk-stream" });
    const createConversationResponse = await request(app)
      .post("/api/conversations")
      .send({
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "medium",
      });
    const conversationId = createConversationResponse.body.conversation.id as string;

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not bind to a TCP port.");
    }

    const clientRequest = http.request({
      hostname: "127.0.0.1",
      port: address.port,
      path: "/api/chat/stream",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    clientRequest.on("error", () => undefined);
    clientRequest.end(
      JSON.stringify({
        conversationId,
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "medium",
        message: "hang",
      }),
    );

    setTimeout(() => clientRequest.destroy(), 100);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const runs = store.listWorkspaceRuns(conversationId);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("cancelled");
    const events = store.listWorkspaceRunEvents(conversationId, runs[0].id);
    expect(events.filter((event) => event.eventType === "run_cancelled")).toHaveLength(1);
  });
});
