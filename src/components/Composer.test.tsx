import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

describe("Composer", () => {
  it("sends on Enter and keeps Shift+Enter for new lines", () => {
    const onSend = vi.fn();

    render(
      <Composer
        disabled={false}
        loadingByProvider={{
          openai: false,
          anthropic: false,
          gemini: false,
          ollama: false,
          "openai-codex": false,
        }}
        message="테스트"
        model="gpt-5.4"
        modelsByProvider={{
          openai: ["gpt-5.4", "gpt-5.4-mini"],
          anthropic: ["claude-sonnet-4-6"],
          gemini: ["gemini-3-flash-preview"],
          ollama: ["qwen3"],
          "openai-codex": ["gpt-5.4"],
        }}
        onMessageChange={() => {}}
        onModelSelect={() => {}}
        onOpenSettings={() => {}}
        onReasoningChange={() => {}}
        onSend={onSend}
        providerKind="openai"
        providers={[
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
        ]}
        reasoningLevel="high"
      />,
    );

    const textarea = screen.getByRole("textbox");

    fireEvent.keyDown(textarea, {
      key: "Enter",
    });

    expect(onSend).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(textarea, {
      key: "Enter",
      shiftKey: true,
    });

    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
