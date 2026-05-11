import path from "node:path";
import { aggregateTokenUsage } from "../token-usage.js";

function parseJsonLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function stringFromPath(value: unknown, keys: string[]) {
  let current = value;
  for (const key of keys) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : null;
}

export function extractAssistantText(event: unknown) {
  if (typeof event === "string") {
    return event;
  }
  if (typeof event !== "object" || event === null) {
    return null;
  }
  const object = event as Record<string, unknown>;
  const candidates = [
    object.delta,
    object.text,
    object.content,
    object.message,
    stringFromPath(object, ["part", "text"]),
    stringFromPath(object, ["assistant", "text"]),
    stringFromPath(object, ["assistant", "content"]),
    stringFromPath(object, ["data", "text"]),
    stringFromPath(object, ["data", "content"]),
    stringFromPath(object, ["message", "content"]),
  ];
  const text = candidates.find((candidate) => typeof candidate === "string" && candidate.length > 0);
  if (typeof text !== "string") {
    return null;
  }
  const type = typeof object.type === "string" ? object.type.toLowerCase() : "";
  const role = typeof object.role === "string" ? object.role.toLowerCase() : "";
  if (role && role !== "assistant") {
    return null;
  }
  if (
    type.includes("error") ||
    type.includes("tool") ||
    type.includes("command") ||
    type.includes("session") ||
    type.includes("status")
  ) {
    return null;
  }
  return text;
}

export function extractExternalSessionId(event: unknown) {
  if (typeof event !== "object" || event === null) {
    return null;
  }
  const object = event as Record<string, unknown>;
  const candidates = [
    object.sessionID,
    object.sessionId,
    object.session_id,
    stringFromPath(object, ["session", "id"]),
    stringFromPath(object, ["data", "sessionID"]),
    stringFromPath(object, ["data", "sessionId"]),
    stringFromPath(object, ["data", "session", "id"]),
  ];
  const id = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof id === "string" ? id : null;
}

export function summarizeJsonEvents(events: unknown[]) {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const type =
      typeof event === "object" && event !== null && typeof (event as { type?: unknown }).type === "string"
        ? (event as { type: string }).type
        : "unknown";
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

export function summarizeTokenUsage(events: unknown[]) {
  return aggregateTokenUsage(events);
}

export function extractJsonEventErrorText(events: unknown[]) {
  for (const event of events) {
    if (typeof event !== "object" || event === null) {
      continue;
    }
    const object = event as Record<string, unknown>;
    const type = typeof object.type === "string" ? object.type.toLowerCase() : "";
    if (!type.includes("error")) {
      continue;
    }
    const candidates = [
      object.message,
      stringFromPath(object, ["error", "message"]),
      stringFromPath(object, ["error", "data", "message"]),
      stringFromPath(object, ["data", "message"]),
      object.error,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
      if (typeof candidate === "object" && candidate !== null) {
        try {
          return JSON.stringify(candidate);
        } catch {
          return "opencode emitted an error event.";
        }
      }
    }
    return "opencode emitted an error event.";
  }
  return null;
}

export function parseModelsFromOutput(output: string) {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }
  const parsed = parseJsonLine(trimmed);
  const modelValues = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { models?: unknown }).models)
      ? (parsed as { models: unknown[] }).models
      : [];
  return modelValues
    .map((model) => {
      if (typeof model === "string") {
        return model;
      }
      if (typeof model === "object" && model !== null) {
        const object = model as Record<string, unknown>;
        return object.id ?? object.name ?? object.model;
      }
      return null;
    })
    .filter((model): model is string => typeof model === "string" && model.trim().length > 0);
}

export function parseSessionsFromOutput(output: string) {
  const parsed = parseJsonLine(output.trim());
  const sessions = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { sessions?: unknown }).sessions)
      ? (parsed as { sessions: unknown[] }).sessions
      : [];
  return sessions.filter((session): session is Record<string, unknown> => typeof session === "object" && session !== null);
}

function safeDisplayPath(input: unknown, projectRoot: string) {
  if (typeof input !== "string" || !input.trim()) {
    return null;
  }

  try {
    const resolvedRoot = path.resolve(projectRoot);
    const resolvedPath = path.resolve(input);
    const relativePath = path.relative(resolvedRoot, resolvedPath);
    if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
      return relativePath.split(path.sep).join(path.posix.sep);
    }
  } catch {
    // Fall through to the generic hidden label. Engine status is a normal UI/API
    // surface, so it should never expose raw absolute host paths.
  }

  return "[path hidden]";
}

export function sanitizeSessionForStatus(session: Record<string, unknown>, projectRoot: string) {
  const sanitized: Record<string, unknown> = {};
  for (const key of ["id", "title", "updated", "created", "projectId"]) {
    const value = session[key];
    if (["string", "number", "boolean"].includes(typeof value) || value === null) {
      sanitized[key] = value;
    }
  }

  if ("directory" in session) {
    sanitized.directory = safeDisplayPath(session.directory, projectRoot) ?? "[path unavailable]";
  }

  return sanitized;
}

export function parseAuthProvidersFromOutput(output: string) {
  const parsed = parseJsonLine(output.trim());
  const providerValues = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { providers?: unknown }).providers)
      ? (parsed as { providers: unknown[] }).providers
      : [];
  const fromJson = providerValues
    .map((provider) => {
      if (typeof provider === "string") {
        return provider;
      }
      if (typeof provider === "object" && provider !== null) {
        const object = provider as Record<string, unknown>;
        return object.id ?? object.name ?? object.provider;
      }
      return null;
    })
    .filter((provider): provider is string => typeof provider === "string" && provider.trim().length > 0);
  if (fromJson.length > 0) {
    return [...new Set(fromJson)].sort();
  }

  const knownProviders = ["openai", "anthropic", "google", "ollama", "github-copilot", "gitlab-duo"];
  const lowerOutput = output.toLowerCase();
  return knownProviders.filter((provider) => lowerOutput.includes(provider)).sort();
}

export function normalizeOpenCodeAuthProvider(provider: string | undefined) {
  const normalized = provider?.trim().toLowerCase() || "openai";
  const aliases: Record<string, string> = {
    "openai-codex": "openai",
    codex: "openai",
    gemini: "google",
  };
  return aliases[normalized] ?? normalized;
}

export { parseJsonLine };
