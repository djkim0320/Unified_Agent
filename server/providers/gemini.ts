import { z } from "zod";
import { ensureOk, readJson } from "../lib/streaming.js";
import type { ProviderSecret } from "../types.js";
import type { ProviderAdapter } from "./base.js";
import { testProviderModelListing } from "./base.js";

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

async function listGeminiModels(secret: ProviderSecret<"gemini"> | null) {
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
}

export const geminiAdapter: ProviderAdapter<"gemini"> = {
  kind: "gemini",
  label: "Gemini",
  defaultModel: "gemini-3.1-pro-preview",
  listModels: listGeminiModels,

  async testConnection(secret) {
    return testProviderModelListing<"gemini">(
      secret,
      listGeminiModels,
      "Gemini connection test failed.",
    );
  },
};
