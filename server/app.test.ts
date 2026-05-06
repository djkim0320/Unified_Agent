import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

const UNSAFE_TEST_METHODS = new Set(["post", "put", "patch", "delete"]);

function request(app: Parameters<typeof supertest>[0]) {
  const client = supertest(app);
  const token =
    typeof (app as { locals?: { localApiToken?: unknown } }).locals?.localApiToken === "string"
      ? ((app as unknown as { locals: { localApiToken: string } }).locals.localApiToken)
      : null;

  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (
        typeof property === "string" &&
        UNSAFE_TEST_METHODS.has(property) &&
        typeof value === "function"
      ) {
        return (...args: unknown[]) => {
          const test = value.apply(target, args);
          return token ? test.set("X-Local-API-Token", token) : test;
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ReturnType<typeof supertest>;
}

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

function legacyGoneBody(feature: string) {
  return {
    error: `${feature} is not available in AetherOps opencode-only mode. Configure equivalent capabilities in opencode.`,
    engineKind: "opencode",
  };
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
  let originalChatgptLocalHome: string | undefined;
  let openStores: Array<ReturnType<typeof createApp>["store"]>;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-chat-app-"));
    originalCodexHome = process.env.CODEX_HOME;
    originalChatgptLocalHome = process.env.CHATGPT_LOCAL_HOME;
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
    if (originalChatgptLocalHome === undefined) {
      delete process.env.CHATGPT_LOCAL_HOME;
    } else {
      process.env.CHATGPT_LOCAL_HOME = originalChatgptLocalHome;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("protects unsafe local API methods with a generated token", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const tokenResponse = await supertest(app)
      .get("/api/local-api-token")
      .set("Host", "127.0.0.1:8787")
      .set("Origin", "http://127.0.0.1:5173")
      .expect(200);
    const token = tokenResponse.body.token as string;
    expect(token).toBeTruthy();
    expect(fs.existsSync(path.join(dataDir, "local-api.token"))).toBe(true);

    await supertest(app)
      .get("/api/providers")
      .set("Origin", "http://127.0.0.1:5173")
      .expect(200);
    await supertest(app)
      .get("/api/providers")
      .set("Origin", "https://example.com")
      .expect(403);
    await supertest(app)
      .put("/api/providers/openai/account")
      .send({ apiKey: "sk-missing" })
      .expect(401);
    await supertest(app)
      .put("/api/providers/openai/account")
      .set("X-Local-API-Token", "wrong")
      .send({ apiKey: "sk-invalid" })
      .expect(401);
    await supertest(app)
      .put("/api/providers/openai/account")
      .set("X-Local-API-Token", token)
      .send({ apiKey: "sk-valid" })
      .expect(200);
  });

  it("hardens local API token bootstrap to local hosts and origins", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    await supertest(app)
      .get("/api/local-api-token")
      .set("Host", "localhost:8787")
      .set("Origin", "http://localhost:5173")
      .expect(200);

    await supertest(app)
      .get("/api/local-api-token")
      .set("Host", "evil.example:8787")
      .set("Origin", "http://127.0.0.1:5173")
      .expect(403);

    await supertest(app)
      .get("/api/local-api-token")
      .set("Host", "127.0.0.1:8787")
      .set("Origin", "https://evil.example")
      .expect(403);
  });

  it("can disable local API token bootstrap exposure in stricter mode", async () => {
    const previous = process.env.AETHEROPS_EXPOSE_LOCAL_API_TOKEN;
    process.env.AETHEROPS_EXPOSE_LOCAL_API_TOKEN = "false";
    try {
      const { app, store } = createApp({ dataDir, projectRoot: dataDir });
      openStores.push(store);

      await supertest(app)
        .get("/api/local-api-token")
        .set("Host", "127.0.0.1:8787")
        .set("Origin", "http://127.0.0.1:5173")
        .expect(404);
    } finally {
      if (previous === undefined) {
        delete process.env.AETHEROPS_EXPOSE_LOCAL_API_TOKEN;
      } else {
        process.env.AETHEROPS_EXPOSE_LOCAL_API_TOKEN = previous;
      }
    }
  });

  it("returns a backend health status for the local UI", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const apiResponse = await request(app).get("/api/health").expect(200);
    expect(apiResponse.body).toEqual(
      expect.objectContaining({
        ok: true,
        service: "aetherops",
        timestamp: expect.any(String),
      }),
    );

    await request(app).get("/health").expect(200);
  });

  it("exposes execution engine status through the native API", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const response = await request(app).get("/api/engine/status").expect(200);

    expect(response.body.engineKind).toBe("opencode");
    expect(response.body.available).toBe(true);
    expect(response.body.executable).toBe("opencode-test-harness");
  });

  it("starts the official opencode OAuth helper through a protected endpoint", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const response = await request(app)
      .post("/api/engine/opencode/auth/login")
      .send({ provider: "openai-codex", launch: false })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        ok: true,
        launched: false,
        provider: "openai",
      }),
    );
    expect(response.body.command).toContain("auth login");
  });

  it("returns structured Zod details for invalid request payloads", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const response = await request(app)
      .put("/api/providers/not-a-provider/account")
      .send({ apiKey: "sk-invalid" })
      .expect(400);

    expect(response.body).toEqual(
      expect.objectContaining({
        error: "Invalid request.",
        details: expect.arrayContaining([
          expect.objectContaining({
            code: expect.any(String),
            message: expect.any(String),
          }),
        ]),
      }),
    );
  });

  it("returns Gone for custom Computer Use routes in opencode-only mode", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const settingsResponse = await supertest(app)
      .get("/api/computer-use/settings")
      .expect(410);
    expect(settingsResponse.body).toEqual(legacyGoneBody("Custom Computer Use API"));

    const writeSettingsResponse = await request(app)
      .put("/api/computer-use/settings")
      .send({ enabled: true })
      .expect(410);
    expect(writeSettingsResponse.body).toEqual(legacyGoneBody("Custom Computer Use API"));

    const sessionsResponse = await request(app)
      .post("/api/computer-use/sessions")
      .send({ allowedDomains: ["localhost"] })
      .expect(410);
    expect(sessionsResponse.body).toEqual(legacyGoneBody("Custom Computer Use API"));
  });

  it("returns Gone for custom Computer Use action routes", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    await request(app)
      .post("/api/computer-use/sessions/session-1/click")
      .send({ selector: "" })
      .expect(410);

    await request(app)
      .post("/api/computer-use/sessions/session-1/type")
      .send({ selector: "input", text: "redacted", typedTextKind: "secret" })
      .expect(410);
  });

  it("returns Gone for local skill files in opencode-only mode", async () => {
    const projectRoot = path.join(dataDir, "project-root");
    const appDataDir = path.join(dataDir, "db");
    fs.mkdirSync(projectRoot, { recursive: true });
    const context = createApp({ dataDir: appDataDir, projectRoot });
    openStores.push(context.store);

    const response = await request(context.app)
      .post("/api/agents/default-agent/skills")
      .send({
        name: "Aviation Planner",
        content: "- Split long aviation work into requirements, research, variants, plan, and decision log.",
        scope: "agent",
      })
      .expect(410);

    const skillsResponse = await request(context.app)
      .get("/api/agents/default-agent/skills")
      .expect(410);
    expect(response.body.engineKind).toBe("opencode");
    expect(skillsResponse.body.engineKind).toBe("opencode");
    expect(fs.existsSync(path.join(projectRoot, "workspace", "agents"))).toBe(false);
  });

  it("exposes skill templates and applies them only as opencode prompt metadata", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const catalogResponse = await request(app).get("/api/skill-templates").expect(200);
    expect(catalogResponse.body.boundary).toContain("does not execute skills directly");
    expect(catalogResponse.body.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "codebase-review",
          name: "Codebase Review",
          flowTemplate: expect.objectContaining({
            steps: expect.arrayContaining([
              expect.objectContaining({ stepKey: "scope" }),
            ]),
          }),
        }),
        expect.objectContaining({ id: "aircraft-research-flow" }),
        expect.objectContaining({ id: "cfd-preparation-flow" }),
      ]),
    );
    expect(catalogResponse.body.templates).toHaveLength(9);

    const standingResponse = await request(app)
      .post("/api/agents/default-agent/skill-templates/codebase-review/apply-standing-orders")
      .send({})
      .expect(200);
    expect(standingResponse.body.applied).toBe(true);
    expect(standingResponse.body.standingOrders.content).toContain("## Skill: Codebase Review");
    expect(standingResponse.body.boundary).toContain("opencode-only");

    const duplicateStandingResponse = await request(app)
      .post("/api/agents/default-agent/skill-templates/codebase-review/apply-standing-orders")
      .send({})
      .expect(200);
    expect(duplicateStandingResponse.body.applied).toBe(false);
    expect(
      (
        duplicateStandingResponse.body.standingOrders.content.match(
          /aetherops-skill-template:standing-orders:codebase-review/g,
        ) ?? []
      ).length,
    ).toBe(1);

    const heartbeatBefore = await request(app).get("/api/agents/default-agent/heartbeat").expect(200);
    expect(heartbeatBefore.body.heartbeat.enabled).toBe(false);

    const heartbeatResponse = await request(app)
      .post("/api/agents/default-agent/skill-templates/codebase-review/apply-heartbeat")
      .send({})
      .expect(200);
    expect(heartbeatResponse.body.applied).toBe(true);
    expect(heartbeatResponse.body.heartbeat.enabled).toBe(false);
    expect(heartbeatResponse.body.heartbeat.instructions).toContain("## Skill: Codebase Review");

    const legacySkillsResponse = await request(app).get("/api/agents/default-agent/skills").expect(410);
    expect(legacySkillsResponse.body.engineKind).toBe("opencode");
  });

  it("returns Gone for metadata-only MCP bridge profiles in opencode-only mode", async () => {
    const projectRoot = path.join(dataDir, "project-root");
    const appDataDir = path.join(dataDir, "db");
    fs.mkdirSync(projectRoot, { recursive: true });
    const context = createApp({ dataDir: appDataDir, projectRoot });
    openStores.push(context.store);

    const response = await request(context.app)
      .post("/api/mcp/servers")
      .send({
        label: "filesystem mcp",
        transport: "stdio",
        command: "npx -y @modelcontextprotocol/server-filesystem ./workspace",
        enabled: true,
      })
      .expect(410);
    expect(response.body).toEqual(legacyGoneBody("MCP/profile registration"));
    expect(fs.existsSync(path.join(projectRoot, "workspace", "shared", "plugins"))).toBe(false);

    const pluginsResponse = await request(context.app).get("/api/plugins").expect(200);
    expect(pluginsResponse.body.plugins).toEqual([]);
    expect(pluginsResponse.body.engineKind).toBe("opencode");
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
    expect(openaiResponse.body.models).toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
    ]);

    const anthropicResponse = await request(app).get("/api/providers/anthropic/models");
    expect(anthropicResponse.status).toBe(200);
    expect(anthropicResponse.body.models).toEqual([
      "claude-opus-4-7",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);

    const geminiResponse = await request(app).get("/api/providers/gemini/models");
    expect(geminiResponse.status).toBe(200);
    expect(geminiResponse.body.models).toEqual([
      "gemini-3.1-pro-preview",
      "gemini-3.1-pro-preview-customtools",
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite-preview",
    ]);
  });

  it("exposes channels and disables internal tool/plugin/skill surfaces in opencode-only mode", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const toolsResponse = await request(app).get("/api/tools");
    expect(toolsResponse.status).toBe(410);
    expect(toolsResponse.body).toEqual(legacyGoneBody("AetherOps internal tool runtime"));

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
    expect(pluginsResponse.body.plugins).toEqual([]);
    expect(pluginsResponse.body.engineKind).toBe("opencode");

    const skillsResponse = await request(app).get("/api/agents/default-agent/skills");
    expect(skillsResponse.status).toBe(410);
    expect(skillsResponse.body).toEqual(legacyGoneBody("AetherOps skill/plugin execution"));
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
    expect(writeMemoryResponse.status).toBe(410);
    expect(writeMemoryResponse.body.engineKind).toBe("opencode");

    const memoryResponse = await request(app).get(`/api/agents/${agentId}/memory`);
    expect(memoryResponse.status).toBe(410);
    expect(JSON.stringify(memoryResponse.body)).not.toContain(dataDir);

    const memorySearchResponse = await request(app).get(
      `/api/agents/${agentId}/memory/search?query=${encodeURIComponent("Korean summaries")}&maxResults=5`,
    );
    expect(memorySearchResponse.status).toBe(410);
    expect(memorySearchResponse.body.engineKind).toBe("opencode");
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

  it("manages automation rules and triggers scheduled opencode tasks", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const conversation = store.saveConversation({
      title: "Automation session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });

    const createResponse = await request(app)
      .post("/api/agents/default-agent/automation-rules")
      .send({
        conversationId: conversation.id,
        title: "Daily cockpit sweep",
        prompt: "Summarize changed files and next actions.",
        intervalMinutes: 30,
        enabled: true,
      })
      .expect(201);

    const ruleId = createResponse.body.rule.id as string;
    expect(createResponse.body.rule).toEqual(
      expect.objectContaining({
        agentId: "default-agent",
        conversationId: conversation.id,
        title: "Daily cockpit sweep",
        enabled: true,
        intervalMinutes: 30,
      }),
    );

    const listResponse = await request(app).get("/api/agents/default-agent/automation-rules").expect(200);
    expect(listResponse.body.rules).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ruleId })]),
    );

    const updateResponse = await request(app)
      .patch(`/api/agents/default-agent/automation-rules/${ruleId}`)
      .send({ enabled: false, intervalMinutes: 45 })
      .expect(200);
    expect(updateResponse.body.rule).toEqual(
      expect.objectContaining({
        id: ruleId,
        enabled: false,
        intervalMinutes: 45,
      }),
    );

    const triggerResponse = await request(app)
      .post(`/api/agents/default-agent/automation-rules/${ruleId}/trigger`)
      .expect(200);
    expect(triggerResponse.body.task).toEqual(
      expect.objectContaining({
        automationRuleId: ruleId,
        taskKind: "scheduled",
        title: "[자동화] Daily cockpit sweep",
      }),
    );

    await request(app).delete(`/api/agents/default-agent/automation-rules/${ruleId}`).expect(200);
    expect(store.getAutomationRule(ruleId)).toBeNull();
    expect(store.getTask(triggerResponse.body.task.id)).toEqual(
      expect.objectContaining({
        automationRuleId: null,
      }),
    );
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

    const getRunResponse = await request(app).get(
      `/api/runs/${taskBackedRun.id}?conversationId=${conversation.id}`,
    );
    expect(getRunResponse.status).toBe(200);
    expect(getRunResponse.body.run).toEqual(
      expect.objectContaining({
        id: taskBackedRun.id,
        taskId: detachedTask.id,
        phase: "planning",
      }),
    );

    const unscopedRunResponse = await request(app).get(`/api/runs/${taskBackedRun.id}`);
    expect(unscopedRunResponse.status).toBe(400);

    const otherConversation = store.saveConversation({
      title: "Other session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const wrongScopeRunResponse = await request(app).get(
      `/api/runs/${taskBackedRun.id}?conversationId=${otherConversation.id}`,
    );
    expect(wrongScopeRunResponse.status).toBe(404);

    const engineRunResponse = await request(app).get(
      `/api/engine/runs/${taskBackedRun.id}?conversationId=${conversation.id}`,
    );
    expect(engineRunResponse.status).toBe(200);
    expect(engineRunResponse.body.engineRun).toEqual(
      expect.objectContaining({
        runId: taskBackedRun.id,
        engineKind: "opencode",
      }),
    );

    const cancelRunResponse = await request(app).post(
      `/api/runs/${taskBackedRun.id}/cancel?conversationId=${conversation.id}`,
    );
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

    const resumeRunResponse = await request(app).post(
      `/api/runs/${resumableRun.id}/resume?conversationId=${conversation.id}`,
    );
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

    const debugResponse = await request(app).get(`/api/agents/${owner.id}/tasks/${taskId}/debug`);
    expect(debugResponse.status).toBe(200);
    expect(debugResponse.body.summary).toEqual(
      expect.objectContaining({
        status: "cancelled",
        taskKind: "detached",
      }),
    );
    expect(debugResponse.body.task.prompt).toBeUndefined();
  });

  it("returns execution preflight checks for the selected agent and conversation", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);
    const conversation = store.saveConversation({
      agentId: "default-agent",
      title: "Preflight session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });

    const response = await request(app)
      .get(`/api/preflight?agentId=default-agent&conversationId=${conversation.id}`)
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        ok: expect.any(Boolean),
        checks: expect.arrayContaining([
          expect.objectContaining({ id: "backend", status: "ok" }),
          expect.objectContaining({ id: "agent", status: "ok" }),
          expect.objectContaining({ id: "conversation", status: "ok" }),
          expect.objectContaining({ id: "workspace", status: "ok" }),
          expect.objectContaining({ id: "scheduler" }),
        ]),
      }),
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
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;

    try {
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
      const isolatedHome = path.join(dataDir, "empty-home");
      fs.mkdirSync(isolatedHome, { recursive: true });
      process.env.CHATGPT_LOCAL_HOME = path.join(dataDir, "empty-chatgpt-local");
      process.env.CODEX_HOME = path.join(dataDir, "empty-codex-home");
      process.env.HOME = isolatedHome;
      process.env.USERPROFILE = isolatedHome;
      fs.mkdirSync(process.env.CHATGPT_LOCAL_HOME, { recursive: true });
      fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });

      const missingResponse = await request(app).post("/api/providers/openai-codex/import-cli-auth");
      expect(missingResponse.status).toBe(400);
      expect(missingResponse.body.error).toContain("Codex auth file not found");
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = previousUserProfile;
      }
    }
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
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(treeResponse.status).toBe(410);
    expect(JSON.stringify(treeResponse.body)).not.toContain(dataDir);
    expect(treeResponse.body.engineKind).toBe("opencode");

    const fileResponse = await request(app).get(
      `/api/workspace/file?conversationId=${conversationId}&scope=sandbox&path=${encodeURIComponent("메모.txt")}`,
    );
    expect(fileResponse.status).toBe(410);
    expect(fileResponse.body.engineKind).toBe("opencode");
    expect(fileResponse.body.error).toContain("Workspace file CRUD");

    const rootResponse = await request(app).get(
      `/api/workspace/tree?conversationId=${conversationId}&scope=root`,
    );
    expect(rootResponse.status).toBe(410);
  });

  it("returns Gone for workspace file and folder CRUD routes", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);

    const createConversationResponse = await request(app)
      .post("/api/conversations")
      .send({
        title: "Workspace writer",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "medium",
      });
    const conversationId = createConversationResponse.body.conversation.id as string;

    const fileResponse = await request(app)
      .post("/api/workspace/file")
      .send({
        conversationId,
        scope: "sandbox",
        path: "research/notes.md",
        content: "# Notes\n\nhello",
      });
    expect(fileResponse.status).toBe(410);
    expect(fileResponse.body.engineKind).toBe("opencode");

    const conflictResponse = await request(app)
      .post("/api/workspace/file")
      .send({
        conversationId,
        scope: "sandbox",
        path: "research/notes.md",
        content: "replace me",
      });
    expect(conflictResponse.status).toBe(410);

    const folderResponse = await request(app)
      .post("/api/workspace/folder")
      .send({
        conversationId,
        scope: "shared",
        path: "templates/aviation",
      });
    expect(folderResponse.status).toBe(410);

    const rootWriteResponse = await request(app)
      .post("/api/workspace/file")
      .send({
        conversationId,
        scope: "root",
        path: "unsafe.txt",
        content: "nope",
      });
    expect(rootWriteResponse.status).toBe(410);
  });

  it("keeps workspace file routes Gone even when debug paths are enabled", async () => {
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
      expect(treeResponse.status).toBe(410);
      expect(treeResponse.body.engineKind).toBe("opencode");
      expect(JSON.stringify(treeResponse.body)).not.toContain(dataDir);

      const fileResponse = await request(app).get(
        `/api/workspace/file?conversationId=${conversationId}&scope=sandbox&path=notes.txt`,
      );
      expect(fileResponse.status).toBe(410);
      expect(fileResponse.body.engineKind).toBe("opencode");
      expect(JSON.stringify(fileResponse.body)).not.toContain(dataDir);
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

  it("reads standing orders, disables memory routes, and lists sub-agent sessions", async () => {
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
    expect(memoryWriteResponse.status).toBe(410);
    expect(memoryWriteResponse.body.engineKind).toBe("opencode");

    const memorySearchResponse = await request(app).get(
      "/api/agents/default-agent/memory/search?query=Korean&maxResults=5",
    );
    expect(memorySearchResponse.status).toBe(410);
    expect(memorySearchResponse.body.engineKind).toBe("opencode");

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
        autoStart: false,
        steps: [
          {
            stepKey: "inspect",
            title: "Inspect repo",
            prompt: "Inspect the repo and report the current state.",
          },
          {
            stepKey: "summarize",
            title: "Summarize",
            prompt: "Summarize the inspected state and name any blockers.",
            dependencyStepKey: "inspect",
          },
        ],
      });

    expect(createFlowResponse.status).toBe(200);
    const flowId = createFlowResponse.body.flow.id as string;
    expect(createFlowResponse.body.flow.status).toBe("queued");
    expect(createFlowResponse.body.steps).toHaveLength(2);
    expect(createFlowResponse.body.steps[0].task).toBeNull();

    const startResponse = await request(app).post(`/api/flows/${flowId}/start`);
    expect(startResponse.status).toBe(200);

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
          task: expect.objectContaining({
            status: "completed",
          }),
          run: expect.objectContaining({
            status: "completed",
          }),
        }),
        expect.objectContaining({
          stepKey: "summarize",
          status: "completed",
        }),
      ]),
    );
    expect(flowResponse.body.report).toEqual(
      expect.objectContaining({
        kind: "report",
        title: "Flow Report: Ship patch",
        metadata: expect.objectContaining({
          reportType: "flow",
          flowId,
        }),
      }),
    );

    const retryResponse = await request(app).post(
      `/api/flows/${flowId}/steps/${flowResponse.body.steps[0].id}/retry`,
    );
    expect(retryResponse.status).toBe(200);
    await vi.waitFor(() => {
      expect(store.getTaskFlow(flowId)?.status).toBe("completed");
    });

    const skipResponse = await request(app).post(
      `/api/flows/${flowId}/steps/${flowResponse.body.steps[0].id}/skip`,
    );
    expect(skipResponse.status).toBe(200);
    expect(skipResponse.body.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepKey: "inspect",
          status: "skipped",
        }),
      ]),
    );

    const cancelledFlowResponse = await request(app)
      .post("/api/agents/default-agent/flows")
      .send({
        conversationId,
        title: "Resume patch",
        autoStart: false,
        steps: [
          {
            stepKey: "resume-step",
            title: "Resume step",
            prompt: "Resume this step.",
          },
        ],
      });
    const cancelledFlowId = cancelledFlowResponse.body.flow.id as string;
    const cancelResponse = await request(app).post(`/api/flows/${cancelledFlowId}/cancel`);
    expect(cancelResponse.status).toBe(200);
    const resumeResponse = await request(app).post(`/api/flows/${cancelledFlowId}/resume`);
    expect(resumeResponse.status).toBe(200);
    await vi.waitFor(() => {
      expect(store.getTaskFlow(cancelledFlowId)?.status).toBe("completed");
    });
  });

  it("returns structured 400 errors for invalid task flow dependencies", async () => {
    const { app, store } = createApp({
      dataDir,
      projectRoot: dataDir,
    });
    openStores.push(store);

    const conversationResponse = await request(app)
      .post("/api/conversations")
      .send({
        title: "Invalid flow session",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "medium",
      });
    const conversationId = conversationResponse.body.conversation.id as string;

    const emptyAutoStartResponse = await request(app)
      .post("/api/agents/default-agent/flows")
      .send({
        conversationId,
        title: "Invalid empty flow",
        steps: [],
      });
    expect(emptyAutoStartResponse.status).toBe(400);
    expect(JSON.stringify(emptyAutoStartResponse.body)).toContain("autoStart=false");

    const duplicateResponse = await request(app)
      .post("/api/agents/default-agent/flows")
      .send({
        conversationId,
        title: "Duplicate flow",
        autoStart: false,
        steps: [
          {
            stepKey: "same",
            title: "First",
            prompt: "First.",
          },
          {
            stepKey: "same",
            title: "Second",
            prompt: "Second.",
          },
        ],
      });
    expect(duplicateResponse.status).toBe(400);
    expect(duplicateResponse.body).toEqual(
      expect.objectContaining({
        error: "Invalid task flow request.",
      }),
    );

    const cyclicResponse = await request(app)
      .post("/api/agents/default-agent/flows")
      .send({
        conversationId,
        title: "Cyclic flow",
        autoStart: false,
        steps: [
          {
            stepKey: "a",
            title: "A",
            prompt: "A.",
            dependencyStepKey: "b",
          },
          {
            stepKey: "b",
            title: "B",
            prompt: "B.",
            dependencyStepKey: "a",
          },
        ],
      });
    expect(cyclicResponse.status).toBe(400);
    expect(JSON.stringify(cyclicResponse.body)).toContain("cycle");
  });

  it("edits queued flow steps and protects task-flow audit history", async () => {
    const { app, store } = createApp({
      dataDir,
      projectRoot: dataDir,
    });
    openStores.push(store);

    const conversationResponse = await request(app)
      .post("/api/conversations")
      .send({
        title: "Editable flow session",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "medium",
      });
    const conversationId = conversationResponse.body.conversation.id as string;

    const emptyCreateResponse = await request(app)
      .post("/api/agents/default-agent/flows")
      .send({
        conversationId,
        title: "Empty editable flow",
        autoStart: false,
        steps: [],
      })
      .expect(200);
    const emptyFlowId = emptyCreateResponse.body.flow.id as string;
    expect(emptyCreateResponse.body.steps).toEqual([]);

    const startEmptyResponse = await request(app).post(`/api/flows/${emptyFlowId}/start`);
    expect(startEmptyResponse.status).toBe(409);
    expect(startEmptyResponse.body.error).toContain("at least one step");

    const renameEmptyResponse = await request(app)
      .put(`/api/flows/${emptyFlowId}/steps`)
      .send({ title: "Renamed empty flow", steps: [] })
      .expect(200);
    expect(renameEmptyResponse.body.flow.title).toBe("Renamed empty flow");
    expect(renameEmptyResponse.body.steps).toEqual([]);

    const createFlowResponse = await request(app)
      .post("/api/agents/default-agent/flows")
      .send({
        conversationId,
        title: "Editable flow",
        autoStart: false,
        steps: [
          { stepKey: "inspect", title: "Inspect", prompt: "Inspect." },
          { stepKey: "implement", title: "Implement", prompt: "Implement.", dependencyStepKey: "inspect" },
          { stepKey: "summarize", title: "Summarize", prompt: "Summarize.", dependencyStepKey: "implement" },
        ],
      })
      .expect(200);
    const flowId = createFlowResponse.body.flow.id as string;

    const replaceResponse = await request(app)
      .put(`/api/flows/${flowId}/steps`)
      .send({
        title: "Editable flow revised",
        steps: [
          { stepKey: "summarize", title: "Summarize revised", prompt: "Summarize revised." },
          { stepKey: "inspect", title: "Inspect revised", prompt: "Inspect revised.", dependencyStepKey: "summarize" },
          { stepKey: "verify", title: "Verify", prompt: "Verify.", dependencyStepKey: "inspect" },
        ],
      })
      .expect(200);

    expect(replaceResponse.body.flow.title).toBe("Editable flow revised");
    expect(replaceResponse.body.steps.map((step: { stepKey: string }) => step.stepKey)).toEqual([
      "summarize",
      "inspect",
      "verify",
    ]);
    expect(
      replaceResponse.body.steps.map((step: { dependencyStepKey: string | null; position: number }) => [
        step.dependencyStepKey,
        step.position,
      ]),
    ).toEqual([
      [null, 0],
      ["summarize", 1],
      ["inspect", 2],
    ]);
    expect(store.listTaskFlowSteps(flowId).map((step) => step.stepKey)).not.toContain("implement");

    await request(app)
      .put(`/api/flows/${flowId}/steps`)
      .send({
        steps: [
          { stepKey: "same", title: "Same 1", prompt: "Same 1." },
          { stepKey: "same", title: "Same 2", prompt: "Same 2." },
        ],
      })
      .expect(400);

    await request(app)
      .put(`/api/flows/${flowId}/steps`)
      .send({
        steps: [
          { stepKey: "a", title: "A", prompt: "A.", dependencyStepKey: "b" },
          { stepKey: "b", title: "B", prompt: "B.", dependencyStepKey: "a" },
        ],
      })
      .expect(400);

    const lockedFlow = store.createTaskFlow({
      agentId: "default-agent",
      conversationId,
      title: "Locked flow",
    });
    const lockedStep = store.createTaskFlowStep({
      flowId: lockedFlow.id,
      stepKey: "locked",
      title: "Locked",
      prompt: "Locked.",
    });
    const auditTask = store.createTask({
      agentId: "default-agent",
      conversationId,
      title: lockedStep.title,
      prompt: lockedStep.prompt,
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
      taskKind: "flow_step",
      taskFlowId: lockedFlow.id,
      flowStepKey: lockedStep.stepKey,
    });
    store.transitionTaskFlowStep({
      stepId: lockedStep.id,
      taskId: auditTask.id,
      status: "completed",
      completedAt: Date.now(),
    });

    await request(app)
      .put(`/api/flows/${lockedFlow.id}/steps`)
      .send({ steps: [{ stepKey: "new", title: "New", prompt: "New." }] })
      .expect(409);

    const deleteResponse = await request(app).delete(`/api/flows/${lockedFlow.id}`).expect(200);
    expect(deleteResponse.body).toEqual({ ok: true, flowId: lockedFlow.id });
    expect(store.getTaskFlow(lockedFlow.id)).toBeNull();
    expect(store.listTaskFlowSteps(lockedFlow.id)).toEqual([]);
    expect(store.getTask(auditTask.id)).toEqual(
      expect.objectContaining({
        id: auditTask.id,
        taskFlowId: null,
        flowStepKey: lockedStep.stepKey,
      }),
    );

    const runningFlow = store.createTaskFlow({
      agentId: "default-agent",
      conversationId,
      title: "Running flow",
    });
    store.createTaskFlowStep({
      flowId: runningFlow.id,
      stepKey: "running",
      title: "Running",
      prompt: "Running.",
    });
    store.transitionTaskFlow({ flowId: runningFlow.id, status: "running" });

    await request(app)
      .put(`/api/flows/${runningFlow.id}/steps`)
      .send({ steps: [{ stepKey: "new", title: "New", prompt: "New." }] })
      .expect(409);
    await request(app).delete(`/api/flows/${runningFlow.id}`).expect(409);
    expect(store.getTaskFlow(runningFlow.id)).toEqual(expect.objectContaining({ status: "running" }));
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

    const runResponse = await request(app).get(
      `/api/runs/${cancelRun.id}?conversationId=${cancelConversation.id}`,
    );
    expect(runResponse.status).toBe(200);
    expect(runResponse.body.run).toEqual(
      expect.objectContaining({
        id: cancelRun.id,
        taskId: cancelTask.id,
      }),
    );

    const cancelResponse = await request(app).post(
      `/api/runs/${cancelRun.id}/cancel?conversationId=${cancelConversation.id}`,
    );
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

    const resumeResponse = await request(app).post(
      `/api/runs/${resumeRun.id}/resume?conversationId=${resumeConversation.id}`,
    );
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
        "X-Local-API-Token": app.locals.localApiToken as string,
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

  it("generates deterministic flow drafts without creating database flows", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);
    const conversation = store.saveConversation({
      title: "Flow draft session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });

    const response = await request(app)
      .post("/api/agents/default-agent/flows/draft")
      .send({
        conversationId: conversation.id,
        prompt: "1. 요구사항 정리\n2. 자료 조사\n3. 검증",
        title: "항공 연구 Flow",
      })
      .expect(200);

    expect(response.body.draft.title).toBe("항공 연구 Flow");
    expect(response.body.draft.steps.map((step: { stepKey: string }) => step.stepKey)).toEqual([
      "requirements",
      "research",
      "verification",
    ]);
    expect(response.body.draft.steps[1].dependencyStepKey).toBe("requirements");
    expect(store.listTaskFlows("default-agent")).toEqual([]);
  });

  it("stores, refreshes, and reads session summaries", async () => {
    const { app, store } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);
    const conversation = store.saveConversation({
      title: "Summary session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    store.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: "항공 연구 자동화 계획을 정리해줘.",
    });
    const run = store.createWorkspaceRun({
      conversationId: conversation.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "Create report",
    });
    store.finalizeWorkspaceRun(run.id, "completed", "run_complete", {
      changedFiles: ["report.md"],
    });

    const refreshed = await request(app)
      .post(`/api/conversations/${conversation.id}/summary/refresh`)
      .send({})
      .expect(200);
    expect(refreshed.body.summary.summary).toContain("항공 연구 자동화");
    expect(refreshed.body.summary.summary).toContain("report.md");

    const saved = await request(app)
      .put(`/api/conversations/${conversation.id}/summary`)
      .send({
        summary: "사용자가 직접 정리한 세션 요약",
        decisions: ["opencode-only 유지"],
        openQuestions: ["검증 범위"],
        nextActions: ["Flow 생성"],
      })
      .expect(200);
    expect(saved.body.summary.decisions).toEqual(["opencode-only 유지"]);

    const read = await request(app)
      .get(`/api/conversations/${conversation.id}/summary`)
      .expect(200);
    expect(read.body.summary.summary).toBe("사용자가 직접 정리한 세션 요약");
  });

  it("indexes run-scoped artifacts, previews text safely, and returns run debug data", async () => {
    const { app, store, workspace } = createApp({ dataDir, projectRoot: dataDir });
    openStores.push(store);
    const conversation = store.saveConversation({
      title: "Artifact session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    workspace.createConversationWorkspace(conversation.id);
    workspace.writeFile({
      conversationId: conversation.id,
      scope: "sandbox",
      relativePath: "notes/report.md",
      content: "# Report\n\nhello artifact",
    });
    const run = store.createWorkspaceRun({
      conversationId: conversation.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "write report",
    });
    const artifacts = store.createArtifactsForRun({
      agentId: conversation.agentId,
      conversationId: conversation.id,
      runId: run.id,
      changedFiles: ["notes/report.md"],
    });
    store.finalizeWorkspaceRun(run.id, "completed", "run_complete", {
      changedFiles: ["notes/report.md"],
      engineRun: {
        runId: run.id,
        engineKind: "opencode",
        status: "completed",
        externalSessionId: "opencode-session",
        workspacePath: ".",
        model: "openai/gpt-5.4",
        command: null,
        exitCode: 0,
        eventSummary: {},
        startedAt: run.createdAt,
        completedAt: Date.now(),
      },
    });

    const listResponse = await request(app)
      .get(`/api/runs/${run.id}/artifacts?conversationId=${conversation.id}`)
      .expect(200);
    expect(listResponse.body.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "notes/report.md",
          title: "report.md",
        }),
        expect.objectContaining({
          kind: "report",
          title: "Run Completion Report",
          metadata: expect.objectContaining({
            reportType: "run",
          }),
        }),
      ]),
    );
    const reportArtifact = listResponse.body.artifacts.find(
      (artifact: { kind: string }) => artifact.kind === "report",
    );
    expect(reportArtifact).toBeTruthy();

    const previewResponse = await request(app)
      .get(`/api/artifacts/${artifacts[0].id}/preview`)
      .expect(200);
    expect(previewResponse.body.preview.content).toContain("hello artifact");
    expect(JSON.stringify(previewResponse.body)).not.toContain(dataDir);

    const reportPreviewResponse = await request(app)
      .get(`/api/artifacts/${reportArtifact.id}/preview`)
      .expect(200);
    expect(reportPreviewResponse.body.preview.content).toContain("Run Completion Report");
    expect(reportPreviewResponse.body.preview.content).not.toContain(dataDir);

    const diffResponse = await request(app)
      .get(`/api/artifacts/${artifacts[0].id}/diff`)
      .expect(200);
    expect(diffResponse.body.diff.available).toBe(false);

    const debugResponse = await request(app)
      .get(`/api/runs/${run.id}/debug?conversationId=${conversation.id}`)
      .expect(200);
    expect(debugResponse.body.summary).toEqual(
      expect.objectContaining({
        status: "completed",
        artifactCount: 2,
        changedFiles: ["notes/report.md"],
      }),
    );
    expect(debugResponse.body.report).toEqual(
      expect.objectContaining({
        id: reportArtifact.id,
        kind: "report",
      }),
    );
    expect(debugResponse.body.engineRun).toEqual(
      expect.objectContaining({
        engineKind: "opencode",
      }),
    );
    expect(JSON.stringify(debugResponse.body)).not.toContain("write report");
    expect(debugResponse.body.run).toEqual(
      expect.objectContaining({
        hasUserMessage: true,
      }),
    );
  });

  it("exposes opencode MCP catalog/status and creates only opencode-backed test tasks", async () => {
    const previousConfigContent = process.env.OPENCODE_CONFIG_CONTENT;
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      mcp: {
        filesystem: {
          type: "stdio",
          command: "mock-filesystem-mcp",
          args: ["D:\\sensitive\\absolute\\path"],
        },
      },
    });
    delete process.env.OPENCODE_CONFIG_DIR;

    try {
      const { app, store } = createApp({ dataDir, projectRoot: dataDir });
      openStores.push(store);
      const conversation = store.saveConversation({
        title: "MCP test session",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "medium",
      });

      const catalogResponse = await request(app).get("/api/mcp/catalog").expect(200);
      expect(catalogResponse.body.boundary).toContain("직접 실행하지 않습니다");
      expect(catalogResponse.body.servers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "filesystem",
            riskLevel: "high",
          }),
        ]),
      );

      const statusResponse = await request(app).get("/api/mcp/config/status").expect(200);
      expect(statusResponse.body.status.configuredCount).toBe(1);
      expect(statusResponse.body.status.configuredServers[0]).toEqual(
        expect.objectContaining({
          id: "filesystem",
          status: "configured",
        }),
      );
      expect(JSON.stringify(statusResponse.body)).not.toContain(dataDir);
      expect(statusResponse.body.status.displayPath).toBe("opencode 기본 설정 경로");

      const testRunResponse = await request(app)
        .post("/api/mcp/test-run")
        .send({
          agentId: "default-agent",
          conversationId: conversation.id,
          catalogId: "filesystem",
          autoStart: false,
        })
        .expect(200);
      expect(testRunResponse.body.boundary).toContain("did not execute MCP directly");
      expect(testRunResponse.body.task).toEqual(
        expect.objectContaining({
          taskKind: "detached",
          status: "queued",
          conversationId: conversation.id,
        }),
      );
      expect(testRunResponse.body.prompt).toContain("Do not modify files");
    } finally {
      if (previousConfigContent === undefined) {
        delete process.env.OPENCODE_CONFIG_CONTENT;
      } else {
        process.env.OPENCODE_CONFIG_CONTENT = previousConfigContent;
      }
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
    }
  });
});
