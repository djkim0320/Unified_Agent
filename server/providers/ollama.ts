import { z } from "zod";
import { ensureOk, readJson } from "../lib/streaming.js";
import type { ProviderSecret } from "../types.js";
import type { ProviderAdapter } from "./base.js";
import { testProviderModelListing } from "./base.js";

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

async function listOllamaModels(secret: ProviderSecret<"ollama"> | null) {
  const config = assertConfigured(secret);
  const response = await ensureOk(
    await fetch(`${normalizeOllamaRoot(config.baseUrl)}/api/tags`),
  );
  const payload = OllamaTagsSchema.parse(await readJson(response));
  return payload.models
    .map((model) => model.name)
    .sort((left, right) => left.localeCompare(right));
}

export const ollamaAdapter: ProviderAdapter<"ollama"> = {
  kind: "ollama",
  label: "Ollama",
  defaultModel: "qwen3",
  listModels: listOllamaModels,

  async testConnection(secret) {
    return testProviderModelListing<"ollama">(
      secret,
      listOllamaModels,
      "Ollama connection test failed.",
    );
  },
};
