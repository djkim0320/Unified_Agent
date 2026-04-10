import { z } from "zod";
import { parseAgentStep } from "../lib/agent-step.js";
import { consumeNdjsonStream, ensureOk, readJson } from "../lib/streaming.js";
import type {
  ChatMessage,
  ProviderSecret,
  ProviderTestResult,
  ReasoningLevel,
} from "../types.js";
import type { ProviderAdapter } from "./base.js";

const OllamaTagsSchema = z.object({
  models: z.array(z.object({ name: z.string() })),
});

function assertConfigured(secret: ProviderSecret<"ollama"> | null) {
  if (!secret?.baseUrl) {
    throw new Error("Ollama base URL is not configured.");
  }
  return secret;
}

function normalizeOllamaRoot(baseUrl: string) {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  return clean.endsWith("/v1") ? clean.slice(0, -3) : clean;
}

async function generateText(params: {
  secret: ProviderSecret<"ollama">;
  model: string;
  _reasoningLevel: ReasoningLevel;
  instructions: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}) {
  const response = await ensureOk(
    await fetch(`${normalizeOllamaRoot(params.secret.baseUrl)}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: params.signal,
      body: JSON.stringify({
        model: params.model,
        messages: [
          {
            role: "system",
            content: params.instructions,
          },
          ...params.messages,
        ],
        stream: false,
      }),
    }),
  );

  const payload = (await readJson(response)) as {
    message?: {
      content?: string;
    };
  };
  const text = payload.message?.content?.trim() ?? "";
  if (!text) {
    throw new Error("Ollama did not return any text.");
  }
  return text;
}

export const ollamaAdapter: ProviderAdapter<"ollama"> = {
  kind: "ollama",
  label: "Ollama",
  defaultModel: "qwen3",

  async listModels(secret) {
    const config = assertConfigured(secret);
    const response = await ensureOk(
      await fetch(`${normalizeOllamaRoot(config.baseUrl)}/api/tags`),
    );
    const payload = OllamaTagsSchema.parse(await readJson(response));
    return payload.models
      .map((model) => model.name)
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
        message: error instanceof Error ? error.message : "Ollama connection test failed.",
      };
    }
  },

  async planToolStep({ secret, model, reasoningLevel, instructions, messages, signal }) {
    const text = await generateText({
      secret,
      model,
      _reasoningLevel: reasoningLevel,
      instructions,
      messages,
      signal,
    });
    return parseAgentStep(text);
  },

  async streamFinalAnswer({ secret, model, messages, instructions, onText, signal }) {
    const response = await ensureOk(
      await fetch(`${normalizeOllamaRoot(secret.baseUrl)}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal,
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: instructions,
            },
            ...messages,
          ],
          stream: true,
        }),
      }),
    );

    await consumeNdjsonStream(response, (payload) => {
      const chunk = payload.message as { content?: unknown } | undefined;
      if (typeof chunk?.content === "string" && chunk.content.length > 0) {
        onText(chunk.content);
      }
    }, signal);
  },
};
