import type { ProviderKind, ProviderSecret } from "../types.js";

export type OpenCodeProviderId = "openai" | "anthropic" | "google" | "ollama";

export interface OpenCodeCredentialSyncEntry {
  providerKind: ProviderKind;
  opencodeProvider: OpenCodeProviderId;
  authMode: "api_key" | "oauth" | "base_url";
  configured: boolean;
  runtimeEnvKeys: string[];
  note: string;
}

export interface OpenCodeCredentialSyncResult {
  env: NodeJS.ProcessEnv;
  config: Record<string, unknown>;
  entries: OpenCodeCredentialSyncEntry[];
}

export function resolveOpenCodeProviderId(kind: ProviderKind): OpenCodeProviderId {
  switch (kind) {
    case "anthropic":
      return "anthropic";
    case "gemini":
      return "google";
    case "ollama":
      return "ollama";
    case "openai":
    case "openai-codex":
    default:
      return "openai";
  }
}

export function modelForOpenCode(providerKind: ProviderKind | string, model: string) {
  if (model.includes("/")) {
    return model;
  }

  const opencodeProvider =
    providerKind === "anthropic"
      ? "anthropic"
      : providerKind === "gemini"
        ? "google"
        : providerKind === "ollama"
          ? "ollama"
          : "openai";

  return `${opencodeProvider}/${model}`;
}

function envKeyForProvider(kind: ProviderKind) {
  switch (kind) {
    case "openai":
      return "AETHEROPS_OPENAI_API_KEY";
    case "anthropic":
      return "AETHEROPS_ANTHROPIC_API_KEY";
    case "gemini":
      return "AETHEROPS_GEMINI_API_KEY";
    default:
      return null;
  }
}

function apiKeyFromSecret(kind: ProviderKind, secret: ProviderSecret<ProviderKind> | null) {
  if (!secret || kind === "ollama" || kind === "openai-codex") {
    return null;
  }
  return "apiKey" in secret && typeof secret.apiKey === "string" && secret.apiKey.trim()
    ? secret.apiKey.trim()
    : null;
}

function baseUrlFromSecret(kind: ProviderKind, secret: ProviderSecret<ProviderKind> | null) {
  if (!secret) {
    return null;
  }
  if (kind === "ollama" && "baseUrl" in secret && typeof secret.baseUrl === "string") {
    return secret.baseUrl.trim() || null;
  }
  return null;
}

export function buildOpenCodeCredentialSync(params: {
  secrets: Partial<Record<ProviderKind, ProviderSecret<ProviderKind> | null>>;
  selectedProviderKind?: ProviderKind | null;
  selectedModel?: string | null;
}): OpenCodeCredentialSyncResult {
  const env: NodeJS.ProcessEnv = {};
  const providerConfig: Record<string, unknown> = {};
  const entries: OpenCodeCredentialSyncEntry[] = [];

  const providerKinds: ProviderKind[] = [
    "openai",
    "anthropic",
    "gemini",
    "ollama",
    "openai-codex",
  ];

  for (const kind of providerKinds) {
    const secret = params.secrets[kind] ?? null;
    const opencodeProvider = resolveOpenCodeProviderId(kind);
    const envKey = envKeyForProvider(kind);
    const apiKey = apiKeyFromSecret(kind, secret);
    const baseUrl = baseUrlFromSecret(kind, secret);
    const providerOptions: Record<string, unknown> = {};
    const runtimeEnvKeys: string[] = [];
    let configured = false;
    let authMode: OpenCodeCredentialSyncEntry["authMode"] = "api_key";
    let note = "Not configured in AetherOps.";

    if (envKey && apiKey) {
      env[envKey] = apiKey;
      runtimeEnvKeys.push(envKey);
      providerOptions.apiKey = `{env:${envKey}}`;
      configured = true;
      note = "AetherOps will pass this API key to opencode only at runtime.";
    }

    if (kind === "gemini" && apiKey) {
      env.GOOGLE_GENERATIVE_AI_API_KEY = apiKey;
      env.GEMINI_API_KEY = apiKey;
      runtimeEnvKeys.push("GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY");
    }

    if (kind === "ollama" && baseUrl) {
      providerOptions.baseURL = baseUrl;
      configured = true;
      authMode = "base_url";
      note = "AetherOps will pass this Ollama base URL to opencode at runtime.";
    }

    if (kind === "openai-codex") {
      authMode = "oauth";
      configured = Boolean(secret);
      note = configured
        ? "Codex OAuth is available to AetherOps. opencode OAuth must still be established through opencode's official auth flow."
        : "Use opencode's official OpenAI ChatGPT Plus/Pro OAuth flow for opencode-native OAuth.";
    }

    if (Object.keys(providerOptions).length > 0) {
      providerConfig[opencodeProvider] = {
        ...((providerConfig[opencodeProvider] as Record<string, unknown> | undefined) ?? {}),
        options: {
          ...(((providerConfig[opencodeProvider] as Record<string, unknown> | undefined)
            ?.options as Record<string, unknown> | undefined) ?? {}),
          ...providerOptions,
        },
      };
    }

    entries.push({
      providerKind: kind,
      opencodeProvider,
      authMode,
      configured,
      runtimeEnvKeys,
      note,
    });
  }

  const config: Record<string, unknown> = {
    provider: providerConfig,
  };

  if (params.selectedProviderKind && params.selectedModel) {
    config.model = modelForOpenCode(params.selectedProviderKind, params.selectedModel);
  }

  return {
    env,
    config,
    entries,
  };
}

export function mergeOpenCodeConfigContent(
  existingContent: string | undefined,
  generatedConfig: Record<string, unknown>,
) {
  let existing: Record<string, unknown> = {};
  if (existingContent?.trim()) {
    try {
      existing = JSON.parse(existingContent) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  return JSON.stringify({
    ...existing,
    ...generatedConfig,
    provider: {
      ...((existing.provider as Record<string, unknown> | undefined) ?? {}),
      ...((generatedConfig.provider as Record<string, unknown> | undefined) ?? {}),
    },
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function mergeOpenCodeConfigObjects(
  ...configs: Array<Record<string, unknown> | null | undefined>
) {
  const merged: Record<string, unknown> = {};

  for (const config of configs) {
    if (!config) {
      continue;
    }
    const previousProvider = objectValue(merged.provider);
    const previousMcp = objectValue(merged.mcp);
    Object.assign(merged, config);
    if ("provider" in config) {
      merged.provider = {
        ...previousProvider,
        ...objectValue(config.provider),
      };
    }
    if ("mcp" in config) {
      merged.mcp = {
        ...previousMcp,
        ...objectValue(config.mcp),
      };
    }
  }

  return merged;
}
