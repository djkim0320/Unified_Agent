import path from "node:path";
import type { AgentMemorySnapshot, ChatMessage } from "../types.js";
import type { createWorkspaceManager } from "./workspace.js";

function clip(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenizeQuery(text: string) {
  return [...new Set(text.toLowerCase().split(/[\s,.;:!?()[\]{}"']+/).filter((token) => token.length >= 2))];
}

export function createMemoryManager(workspace: ReturnType<typeof createWorkspaceManager>) {
  function getSnapshot(agentId: string): AgentMemorySnapshot {
    const record = workspace.readAgentMemory(agentId);
    return {
      agentId,
      durableMemoryPath: "MEMORY.md",
      durableMemory: record.memory,
      dailyMemoryPath: path.posix.join("memory", `${record.date}.md`),
      dailyMemory: record.dailyNote,
    };
  }

  function search(agentId: string, query: string, maxResults = 8) {
    return workspace.searchAgentMemory({
      agentId,
      query,
      maxResults,
    });
  }

  function write(params: {
    agentId: string;
    content: string;
    target?: "durable" | "daily";
  }) {
    return workspace.appendAgentMemory(params);
  }

  function getPlanningContext(params: {
    agentId: string;
    userMessage: string;
    messages: ChatMessage[];
  }) {
    const snapshot = getSnapshot(params.agentId);
    const tokens = tokenizeQuery(
      [params.userMessage, ...params.messages.slice(-6).map((message) => message.content)].join(" "),
    );
    const searchHits =
      tokens.length > 0
        ? search(params.agentId, tokens.slice(0, 6).join(" "), 6)
        : [];

    const durableExcerpt = clip(snapshot.durableMemory.trim(), 1800);
    const dailyExcerpt = clip(snapshot.dailyMemory.trim(), 1400);
    const searchExcerpt = searchHits.length
      ? searchHits
          .map((hit) => `- ${hit.path}:${hit.line} ${clip(hit.text, 220)}`)
          .join("\n")
      : "- No direct memory hits.";

    return {
      snapshot,
      promptBlock: [
        "Agent memory snapshot:",
        `Durable memory (${snapshot.durableMemoryPath}):`,
        durableExcerpt || "- Empty.",
        "",
        `Today note (${snapshot.dailyMemoryPath}):`,
        dailyExcerpt || "- Empty.",
        "",
        "Relevant memory hits:",
        searchExcerpt,
      ].join("\n"),
    };
  }

  function flushSessionSummary(params: {
    agentId: string;
    conversationTitle: string;
    userMessage: string;
    assistantText: string;
  }) {
    const summary = [
      `Session: ${params.conversationTitle}`,
      `User: ${clip(params.userMessage.trim(), 300)}`,
      `Assistant: ${clip(params.assistantText.trim(), 600)}`,
    ].join(" | ");

    if (!summary.trim()) {
      return getSnapshot(params.agentId);
    }

    return write({
      agentId: params.agentId,
      target: "daily",
      content: summary,
    });
  }

  function captureRememberRequest(params: {
    agentId: string;
    message: string;
  }) {
    const normalized = params.message.trim();
    if (!normalized) {
      return null;
    }

    const rememberPatterns = [
      /remember/i,
      /기억해/i,
      /기억해줘/i,
      /앞으로/i,
      /선호/i,
      /prefer/i,
    ];
    if (!rememberPatterns.some((pattern) => pattern.test(normalized))) {
      return null;
    }

    const cleaned = normalized
      .replace(/\b(remember|please)\b/gi, "")
      .replace(/기억(해|해줘)?/g, "")
      .replace(/앞으로/g, "")
      .trim();

    if (!cleaned) {
      return null;
    }

    return write({
      agentId: params.agentId,
      target: "durable",
      content: cleaned.replace(new RegExp(`^${escapeRegExp(":")}`), "").trim(),
    });
  }

  return {
    getSnapshot,
    getPlanningContext,
    search,
    write,
    flushSessionSummary,
    captureRememberRequest,
  };
}
