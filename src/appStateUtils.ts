import type {
  AgentHeartbeatRecord,
  AgentSoulRecord,
  ConversationRecord,
  ProviderDraft,
  ProviderKind,
  ProviderSummary,
  WorkspaceRunEventRecord,
} from "./types";
import type { AgentHeartbeatDraft, AgentSoulDraft } from "./components/AgentSettingsDialog";
import { defaultModels } from "./types";

export const DEFAULT_NEW_CONVERSATION_TITLE = "새 채팅";

export function displayConversationTitle(
  title: string | null | undefined,
  fallback = DEFAULT_NEW_CONVERSATION_TITLE,
) {
  const value = title?.trim();
  if (!value) {
    return fallback;
  }

  // Past builds stored a mojibake version of "새 채팅" in a few local records.
  // Detect the corrupted shape without keeping the broken literal in source.
  if (value.startsWith("??") || /[\uF900-\uFAFF]/u.test(value)) {
    return fallback;
  }
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.includes("\\") || /(^|\/)workspace\/opencode\//i.test(value)) {
    const leaf = value
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.trim();
    if (!leaf || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(leaf)) {
      return fallback;
    }
    return leaf;
  }
  return value;
}

export function displayAppNotice(notice: string | null | undefined) {
  if (!notice) {
    return null;
  }
  return notice;
}

export function createEmptyDrafts(): Record<ProviderKind, ProviderDraft> {
  return {
    openai: { apiKey: "", baseUrl: "" },
    anthropic: { apiKey: "", baseUrl: "" },
    gemini: { apiKey: "", baseUrl: "" },
    ollama: { apiKey: "", baseUrl: "http://127.0.0.1:11434" },
    "openai-codex": { apiKey: "", baseUrl: "" },
  };
}

export function createModelMap() {
  return {
    openai: [defaultModels.openai],
    anthropic: [defaultModels.anthropic],
    gemini: [defaultModels.gemini],
    ollama: [defaultModels.ollama],
    "openai-codex": [defaultModels["openai-codex"]],
  } satisfies Record<ProviderKind, string[]>;
}

export function createLoadingMap(initialValue: boolean) {
  return {
    openai: initialValue,
    anthropic: initialValue,
    gemini: initialValue,
    ollama: initialValue,
    "openai-codex": initialValue,
  } satisfies Record<ProviderKind, boolean>;
}

export function createErrorMap(): Record<ProviderKind, string | null> {
  return {
    openai: null,
    anthropic: null,
    gemini: null,
    ollama: null,
    "openai-codex": null,
  } satisfies Record<ProviderKind, string | null>;
}

export function createAgentSoulDraft(soul: AgentSoulRecord | null): AgentSoulDraft {
  return soul?.content ?? "";
}

export function createAgentHeartbeatDraft(heartbeat: AgentHeartbeatRecord | null): AgentHeartbeatDraft {
  return {
    enabled: heartbeat?.enabled ?? false,
    intervalMinutes: String(heartbeat?.intervalMinutes ?? 60),
    instructions: heartbeat?.instructions ?? "",
  };
}

export function mergeConversationList(
  conversations: ConversationRecord[],
  conversation: ConversationRecord,
) {
  return [...conversations.filter((item) => item.id !== conversation.id), conversation].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}

export function mergeProviderDrafts(
  providers: ProviderSummary[],
  currentDrafts: Record<ProviderKind, ProviderDraft>,
) {
  const nextDrafts = createEmptyDrafts();

  for (const provider of providers) {
    if (provider.kind === "ollama") {
      const metadataBaseUrl =
        typeof provider.metadata.baseUrl === "string" ? provider.metadata.baseUrl : "";
      nextDrafts.ollama.baseUrl =
        currentDrafts.ollama.baseUrl || metadataBaseUrl || "http://127.0.0.1:11434";
      continue;
    }

    nextDrafts[provider.kind].apiKey = currentDrafts[provider.kind].apiKey;
  }

  return nextDrafts;
}

export function getOptimisticMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `temp-${Date.now()}`;
}

export function isProviderEnabled(provider: ProviderSummary | null | undefined) {
  return Boolean(provider && (provider.configured || provider.status !== "disconnected"));
}

export function pickConversationProvider(
  providers: ProviderSummary[],
  preferredProviderKind?: ProviderKind,
) {
  if (preferredProviderKind) {
    return preferredProviderKind;
  }

  const firstEnabled = providers.find((provider) => isProviderEnabled(provider));
  return firstEnabled?.kind ?? "openai";
}

export function createLiveEvent(
  eventType: WorkspaceRunEventRecord["eventType"],
  payload: Record<string, unknown>,
) {
  return {
    id: `live-${Date.now()}-${Math.random()}`,
    runId: "live",
    eventType,
    payload,
    createdAt: Date.now(),
  } satisfies WorkspaceRunEventRecord;
}

export function abortRef(controllerRef: { current: AbortController | null }) {
  controllerRef.current?.abort();
  controllerRef.current = null;
}

export function beginRequest(
  seqRef: { current: number },
  controllerRef: { current: AbortController | null },
) {
  abortRef(controllerRef);
  const controller = new AbortController();
  controllerRef.current = controller;
  seqRef.current += 1;
  return {
    controller,
    seq: seqRef.current,
  };
}
