import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const conversationId = "11111111-1111-4111-8111-111111111111";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });
}

describe("App", () => {
  beforeEach(() => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url === "/api/providers" && method === "GET") {
        return jsonResponse({
          providers: [
            {
              kind: "openai",
              label: "OpenAI",
              configured: true,
              status: "connected",
              displayName: "OpenAI",
              email: null,
              accountId: null,
              metadata: {},
            },
            {
              kind: "anthropic",
              label: "Anthropic",
              configured: false,
              status: "disconnected",
              displayName: null,
              email: null,
              accountId: null,
              metadata: {},
            },
            {
              kind: "gemini",
              label: "Gemini",
              configured: false,
              status: "disconnected",
              displayName: null,
              email: null,
              accountId: null,
              metadata: {},
            },
            {
              kind: "ollama",
              label: "Ollama",
              configured: false,
              status: "disconnected",
              displayName: null,
              email: null,
              accountId: null,
              metadata: {},
            },
            {
              kind: "openai-codex",
              label: "OpenAI Codex",
              configured: false,
              status: "disconnected",
              displayName: null,
              email: null,
              accountId: null,
              metadata: {},
            },
          ],
        });
      }

      if (url === "/api/conversations" && method === "GET") {
        return jsonResponse({ conversations: [] });
      }

      if (url === "/api/conversations" && method === "POST") {
        return jsonResponse({
          conversation: {
            id: conversationId,
            title: "새 채팅",
            providerKind: "openai",
            model: "gpt-5.4",
            reasoningLevel: "high",
            createdAt: 1,
            updatedAt: 1,
          },
        });
      }

      if (url === `/api/conversations/${conversationId}/messages` && method === "GET") {
        return jsonResponse({
          conversation: {
            id: conversationId,
            title: "새 채팅",
            providerKind: "openai",
            model: "gpt-5.4",
            reasoningLevel: "high",
            createdAt: 1,
            updatedAt: 2,
          },
          messages: [],
        });
      }

      if (url === "/api/providers/openai/models" && method === "GET") {
        return jsonResponse({ models: ["gpt-5.4", "gpt-5.4-mini"] });
      }

      if (url === "/api/providers/anthropic/models" && method === "GET") {
        return jsonResponse({
          models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
        });
      }

      if (url === "/api/providers/gemini/models" && method === "GET") {
        return jsonResponse({
          models: [
            "gemini-3-flash-preview",
            "gemini-3.1-pro-preview",
            "gemini-3.1-flash-lite-preview",
          ],
        });
      }

      if (url === "/api/providers/ollama/models" && method === "GET") {
        return jsonResponse({ models: ["qwen3"] });
      }

      if (url === "/api/providers/openai-codex/models" && method === "GET") {
        return jsonResponse({ models: ["gpt-5.4", "gpt-5.4-mini"] });
      }

      if (
        url === `/api/workspace/tree?conversationId=${conversationId}&scope=sandbox&maxDepth=4` &&
        method === "GET"
      ) {
        return jsonResponse({
          scope: "sandbox",
          path: ".",
          tree: [],
          workspaceRoot: "D:/AI/통합 에이전트/workspace",
        });
      }

      if (url === `/api/workspace/runs?conversationId=${conversationId}` && method === "GET") {
        return jsonResponse({ runs: [] });
      }

      throw new Error(`Unhandled request: ${method} ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("boots, creates the first conversation, and loads grouped model options", async () => {
    render(<App />);
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "새 채팅" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "모델 선택: GPT-5.4" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "모델 선택: GPT-5.4" }));

    expect(await screen.findByText("Anthropic")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Claude Sonnet 4\.6/i })).toBeInTheDocument();
    expect(screen.getAllByText("API 미설정").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "채팅은 공통 에이전트 런타임을 통해 파일 작업, 명령 실행, 웹 연구 도구를 호출할 수 있습니다.",
      ),
    ).toBeInTheDocument();
  });
});
