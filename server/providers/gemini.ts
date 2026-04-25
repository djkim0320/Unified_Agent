import { z } from "zod";
import { parseAgentStep } from "../lib/agent-step.js";
import { consumeSseStream, ensureOk, readJson } from "../lib/streaming.js";
import { getGeminiThinkingLevel, normalizeReasoningLevel } from "../reasoning-options.js";
import type {
  ChatMessage,
  ProviderSecret,
  ProviderTestResult,
  ReasoningLevel,
} from "../types.js";
import type { ProviderAdapter } from "./base.js";

const GeminiModelListSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      supportedGenerationMethods: z.array(z.string()).optional(),
    }),
  ),
});

function assertConfigured(secret: ProviderSecret<"gemini"> | null) {
  if (!secret?.apiKey) {
    throw new Error("Gemini API key is not configured.");
  }
  return secret;
}

function toGeminiContents(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
}

function extractGeminiText(payload: Record<string, unknown>) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const firstCandidate = candidates[0] as
    | {
        content?: {
          parts?: Array<{ text?: unknown }>;
        };
      }
    | undefined;

  const parts = firstCandidate?.content?.parts ?? [];
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

async function generateText(params: {
  secret: ProviderSecret<"gemini">;
  model: string;
  reasoningLevel: ReasoningLevel;
  instructions: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}) {
  const normalizedReasoning = normalizeReasoningLevel(
    "gemini",
    params.model,
    params.reasoningLevel,
  );
  const response = await ensureOk(
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(params.secret.apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: params.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: params.instructions }],
          },
          contents: toGeminiContents(params.messages),
          generationConfig: {
            thinkingConfig: {
              thinkingLevel: getGeminiThinkingLevel(normalizedReasoning),
            },
          },
        }),
      },
    ),
  );

  const payload = (await readJson(response)) as Record<string, unknown>;
  const text = extractGeminiText(payload);
  if (!text) {
    throw new Error("Gemini did not return any text.");
  }
  return text;
}

export const geminiAdapter: ProviderAdapter<"gemini"> = {
  kind: "gemini",
  label: "Gemini",
  defaultModel: "gemini-3-flash-preview",

  async listModels(secret) {
    const config = assertConfigured(secret);
    const response = await ensureOk(
      await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(config.apiKey)}`,
      ),
    );
    const payload = GeminiModelListSchema.parse(await readJson(response));
    return payload.models
      .filter((model) =>
        model.supportedGenerationMethods?.some((method) =>
          ["generateContent", "streamGenerateContent"].includes(method),
        ),
      )
      .map((model) => model.name.replace(/^models\//, ""))
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
        message: error instanceof Error ? error.message : "Gemini connection test failed.",
      };
    }
  },

  async planToolStep({ secret, model, reasoningLevel, instructions, messages, signal }) {
    const text = await generateText({
      secret,
      model,
      reasoningLevel,
      instructions,
      messages,
      signal,
    });
    return parseAgentStep(text);
  },

  async streamFinalAnswer({ secret, model, reasoningLevel, instructions, messages, onText, signal }) {
    const normalizedReasoning = normalizeReasoningLevel("gemini", model, reasoningLevel);
    const response = await ensureOk(
      await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(secret.apiKey)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal,
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: instructions }],
            },
            contents: toGeminiContents(messages),
            generationConfig: {
              thinkingConfig: {
                thinkingLevel: getGeminiThinkingLevel(normalizedReasoning),
              },
            },
          }),
        },
      ),
    );

    let assembled = "";

    await consumeSseStream(response, (event) => {
      if (!event.data || event.data === "[DONE]") {
        return;
      }

      const payload = JSON.parse(event.data) as Record<string, unknown>;
      const text = extractGeminiText(payload);
      if (!text) {
        return;
      }

      const delta = text.startsWith(assembled) ? text.slice(assembled.length) : text;
      if (!delta) {
        return;
      }
      assembled += delta;
      onText(delta);
    }, signal);
  },
};
