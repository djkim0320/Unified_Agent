import { z } from "zod";
import { ensureOk, readJson } from "../lib/streaming.js";
import type { ProviderSecret } from "../types.js";
import type { ProviderAdapter } from "./base.js";
import { testProviderModelListing } from "./base.js";

const OpenAIModelListSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

function assertConfigured(secret: ProviderSecret<"openai"> | null) {
  if (!secret?.apiKey) {
    throw new Error("OpenAI API key is not configured.");
  }
  return secret;
}

async function listOpenAIModels(secret: ProviderSecret<"openai"> | null) {
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
}

export const openAIAdapter: ProviderAdapter<"openai"> = {
  kind: "openai",
  label: "OpenAI",
  defaultModel: "gpt-5.5",
  listModels: listOpenAIModels,

  async testConnection(secret) {
    return testProviderModelListing<"openai">(
      secret,
      listOpenAIModels,
      "OpenAI connection test failed.",
    );
  },
};
