import { z } from "zod";

export const ProviderKindSchema = z.enum([
  "openai",
  "anthropic",
  "gemini",
  "ollama",
  "openai-codex",
]);

export const ReasoningLevelSchema = z.enum(["minimal", "low", "medium", "high", "xhigh"]);
