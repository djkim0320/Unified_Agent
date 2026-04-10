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
      expect(treeResponse.body.debug.workspaceRoot).toContain(path.join("workspace", "conversations"));
      expect(treeResponse.body.debug.absolutePath).toContain(conversationId);

      const fileResponse = await request(app).get(
        `/api/workspace/file?conversationId=${conversationId}&scope=sandbox&path=notes.txt`,
      );
      expect(fileResponse.status).toBe(200);
      expect(fileResponse.body.file.absolutePath).toContain(path.join("workspace", "conversations"));
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
