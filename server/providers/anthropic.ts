import { z } from "zod";
import { parseAgentStep } from "../lib/agent-step.js";
import { consumeSseStream, ensureOk, readJson } from "../lib/streaming.js";
import {
  getAnthropicAdaptiveEffort,
  getAnthropicThinkingBudget,
  normalizeReasoningLevel,
} from "../reasoning-options.js";
import type {
  ChatMessage,
  ProviderSecret,
  ProviderTestResult,
  ReasoningLevel,
} from "../types.js";
import type { ProviderAdapter } from "./base.js";

const AnthropicModelListSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

function assertConfigured(secret: ProviderSecret<"anthropic"> | null) {
  if (!secret?.apiKey) {
    throw new Error("Anthropic API key is not configured.");
  }
  return secret;
}

function toAnthropicMessages(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function buildRequestBody(params: {
  model: string;
  reasoningLevel: ReasoningLevel;
  messages: ChatMessage[];
  stream: boolean;
  system?: string;
}) {
  const normalizedReasoning = normalizeReasoningLevel(
    "anthropic",
    params.model,
    params.reasoningLevel,
  );
  const requestBody: Record<string, unknown> = {
    model: params.model,
    max_tokens: 4096,
    stream: params.stream,
    messages: toAnthropicMessages(params.messages),
  };

  if (params.system?.trim()) {
    requestBody.system = params.system;
  }

  if (params.model.startsWith("claude-opus-4-6") || params.model.startsWith("claude-sonnet-4-6")) {
    requestBody.thinking = { type: "adaptive" };
    requestBody.output_config = {
      effort: getAnthropicAdaptiveEffort(normalizedReasoning),
    };
  } else if (params.model.startsWith("claude-haiku-4-5")) {
    requestBody.thinking = {
      type: "enabled",
      budget_tokens: getAnthropicThinkingBudget(normalizedReasoning),
    };
  }

  return requestBody;
}

function extractAnthropicText(payload: Record<string, unknown>) {
  const content = Array.isArray(payload.content)
    ? (payload.content as Array<Record<string, unknown>>)
    : [];
  return content
    .map((item) => {
      if (typeof item.text === "string") {
        return item.text;
      }
      return "";
    })
    .join("")
    .trim();
}

async function generateText(params: {
  secret: ProviderSecret<"anthropic">;
  model: string;
  reasoningLevel: ReasoningLevel;
  instructions: string;
  messages: ChatMessage[];
}) {
  const response = await ensureOk(
    await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": params.secret.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(
        buildRequestBody({
          model: params.model,
          reasoningLevel: params.reasoningLevel,
          messages: params.messages,
          stream: false,
          system: params.instructions,
        }),
      ),
    }),
  );

  const payload = (await readJson(response)) as Record<string, unknown>;
  const text = extractAnthropicText(payload);
  if (!text) {
    throw new Error("Anthropic did not return any text.");
  }
  return text;
}

export const anthropicAdapter: ProviderAdapter<"anthropic"> = {
  kind: "anthropic",
  label: "Anthropic",
  defaultModel: "claude-sonnet-4-6",

  async listModels(secret) {
    const config = assertConfigured(secret);
    const response = await ensureOk(
      await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
      }),
    );
    const payload = AnthropicModelListSchema.parse(await readJson(response));
    return payload.data
      .map((model) => model.id)
      .sort((left, right) => left.localeCompare(right));
  },

  async testConnection(secret): Promise<ProviderTestResult> {
    try {
      const models = await this.listModels(secret);
      return {
        ok: true,
        message: `Connected successfully. Loaded ${models.length} models.`,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Anthropic connection test failed.",
      };
    }
  },

  async planToolStep({ secret, model, reasoningLevel, instructions, messages }) {
    const text = await generateText({
      secret,
      model,
      reasoningLevel,
      instructions,
      messages,
    });
    return parseAgentStep(text);
  },

  async streamFinalAnswer({ secret, model, reasoningLevel, instructions, messages, onText }) {
    const response = await ensureOk(
      await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": secret.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(
          buildRequestBody({
            model,
            reasoningLevel,
            messages,
            stream: true,
            system: instructions,
          }),
        ),
      }),
    );

    await consumeSseStream(response, (event) => {
      if (!event.data || event.data === "[DONE]") {
        return;
      }

      const payload = JSON.parse(event.data) as {
        type?: string;
        delta?: {
          type?: string;
          text?: string;
        };
      };

      if (
        payload.type === "content_block_delta" &&
        payload.delta?.type === "text_delta" &&
        typeof payload.delta.text === "string"
      ) {
        onText(payload.delta.text);
      }
    });
  },
};
