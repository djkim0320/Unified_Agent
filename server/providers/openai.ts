import { z } from "zod";
import { parseAgentStep } from "../lib/agent-step.js";
import { consumeSseStream, ensureOk, readJson } from "../lib/streaming.js";
import { normalizeReasoningLevel } from "../reasoning-options.js";
import type {
  ChatMessage,
  ProviderSecret,
  ProviderTestResult,
  ReasoningLevel,
} from "../types.js";
import type { ProviderAdapter } from "./base.js";

const OpenAIModelListSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

function assertConfigured(secret: ProviderSecret<"openai"> | null) {
  if (!secret?.apiKey) {
    throw new Error("OpenAI API key is not configured.");
  }
  return secret;
}

function toResponseInput(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: [
      {
        type: "input_text",
        text: message.content,
      },
    ],
  }));
}

function extractOpenAIText(payload: Record<string, unknown>) {
  const topLevel = payload.output_text;
  if (typeof topLevel === "string" && topLevel.trim()) {
    return topLevel;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  return output
    .flatMap((item) => {
      if (typeof item !== "object" || item === null) {
        return [];
      }
      const content = Array.isArray((item as { content?: unknown }).content)
        ? ((item as { content: Array<Record<string, unknown>> }).content ?? [])
        : [];
      return content
        .map((part) => {
          if (typeof part.text === "string") {
            return part.text;
          }
          if (
            typeof part === "object" &&
            part !== null &&
            typeof (part as { content?: unknown }).content === "string"
          ) {
            return (part as { content: string }).content;
          }
          return "";
        })
        .filter(Boolean);
    })
    .join("");
}

async function generateText(params: {
  secret: ProviderSecret<"openai">;
  model: string;
  reasoningLevel: ReasoningLevel;
  instructions: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}) {
  const normalizedReasoning = normalizeReasoningLevel(
    "openai",
    params.model,
    params.reasoningLevel,
  );
  const response = await ensureOk(
    await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.secret.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: params.signal,
      body: JSON.stringify({
        model: params.model,
        instructions: params.instructions,
        input: toResponseInput(params.messages),
        reasoning: {
          effort: normalizedReasoning,
        },
      }),
    }),
  );

  const payload = (await readJson(response)) as Record<string, unknown>;
  const text = extractOpenAIText(payload).trim();
  if (!text) {
    throw new Error("OpenAI did not return any text.");
  }
  return text;
}

export const openAIAdapter: ProviderAdapter<"openai"> = {
  kind: "openai",
  label: "OpenAI",
  defaultModel: "gpt-5.4",

  async listModels(secret) {
    const config = assertConfigured(secret);
    const response = await ensureOk(
      await fetch("https://api.openai.com/v1/models", {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      }),
    );
    const payload = OpenAIModelListSchema.parse(await readJson(response));
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
        message: error instanceof Error ? error.message : "OpenAI connection test failed.",
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
    const normalizedReasoning = normalizeReasoningLevel("openai", model, reasoningLevel);
    const response = await ensureOk(
      await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret.apiKey}`,
          "Content-Type": "application/json",
        },
        signal,
        body: JSON.stringify({
          model,
          instructions,
          input: toResponseInput(messages),
          reasoning: {
            effort: normalizedReasoning,
          },
          stream: true,
        }),
      }),
    );

    await consumeSseStream(response, (event) => {
      if (!event.data || event.data === "[DONE]") {
        return;
      }

      const payload = JSON.parse(event.data) as Record<string, unknown>;
      if (
        payload.type === "response.output_text.delta" &&
        typeof payload.delta === "string"
      ) {
        onText(payload.delta);
      }
    }, signal);
  },

  async searchWeb({ secret, model, query, signal }) {
    const response = await ensureOk(
      await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret.apiKey}`,
          "Content-Type": "application/json",
        },
        signal,
        body: JSON.stringify({
          model,
          input: query,
          tools: [{ type: "web_search_preview" }],
        }),
      }),
    );

    const payload = (await readJson(response)) as Record<string, unknown>;
    return {
      backend: "provider_web_search",
      query,
      summary: extractOpenAIText(payload).trim(),
    };
  },
};
