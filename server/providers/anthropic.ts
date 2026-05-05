import { z } from "zod";
import { ensureOk, readJson } from "../lib/streaming.js";
import type { ProviderSecret } from "../types.js";
import type { ProviderAdapter } from "./base.js";
import { testProviderModelListing } from "./base.js";

const AnthropicModelListSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

function assertConfigured(secret: ProviderSecret<"anthropic"> | null) {
  if (!secret?.apiKey) {
    throw new Error("Anthropic API key is not configured.");
  }
  return secret;
}

async function listAnthropicModels(secret: ProviderSecret<"anthropic"> | null) {
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
}

export const anthropicAdapter: ProviderAdapter<"anthropic"> = {
  kind: "anthropic",
  label: "Anthropic",
  defaultModel: "claude-opus-4-7",
  listModels: listAnthropicModels,

  async testConnection(secret) {
    return testProviderModelListing<"anthropic">(
      secret,
      listAnthropicModels,
      "Anthropic connection test failed.",
    );
  },
};
