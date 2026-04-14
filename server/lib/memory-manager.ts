import path from "node:path";
import type { AgentMemorySnapshot, ChatMessage, MemorySearchResult } from "../types.js";
import type { createWorkspaceManager } from "./workspace.js";

function clip(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function tokenizeQuery(text: string) {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[\s,.;:!?()[\]{}"']+/)
        .filter((token) => token.length >= 2),
    ),
  ];
}

const REMEMBER_PATTERNS = [
  /remember/iu,
  /\uAE30\uC5B5/iu,
  /\uC55E\uC73C\uB85C/iu,
  /\uC120\uD638/iu,
  /prefers?/iu,
];
const REMEMBER_CLEANUP_PATTERNS = [
  /\b(remember|please)\b/giu,
  /\uAE30\uC5B5\uD574(?:\uC918|\uC8FC\uC138\uC694)?/giu,
  /\uAE30\uC5B5/giu,
  /\uC55E\uC73C\uB85C/giu,
];

function classifyMemoryKind(relativePath: string): MemorySearchResult["kind"] {
  if (relativePath === "MEMORY.md") {
    return "durable";
  }
  if (relativePath.startsWith("memory/")) {
    return "daily";
  }
  if (relativePath.startsWith("summaries/")) {
    return "session_summary";
  }
  return "outcome";
}

export function createMemoryManager(params: {
  workspace: ReturnType<typeof createWorkspaceManager>;
  store?: {
    replaceMemoryIndex: (
      agentId: string,
      entries: Array<{
        path: string;
        kind: MemorySearchResult["kind"];
        line: number;
        reason: string;
        text: string;
      }>,
    ) => number;
    searchMemoryIndex: (agentId: string, query: string, maxResults?: number) => MemorySearchResult[];
  };
}) {
  const workspace = params.workspace;
  function buildIndexEntries(agentId: string) {
    const agentDir = workspace.createAgentWorkspace(agentId);
    const candidateFiles = [
      path.join(agentDir, "MEMORY.md"),
      ...["memory", "summaries", "outcomes"].flatMap((directory) => {
        const fullDirectory = path.join(agentDir, directory);
        if (!workspace || !fullDirectory || !fullDirectory.trim || !fullDirectory.trim()) {
          return [];
        }
        if (!path.isAbsolute(fullDirectory) || !require("node:fs").existsSync(fullDirectory)) {
          return [];
        }
        return require("node:fs")
          .readdirSync(fullDirectory, { withFileTypes: true })
          .filter((entry: { isFile: () => boolean; name: string }) => entry.isFile() && entry.name.endsWith(".md"))
          .map((entry: { name: string }) => path.join(fullDirectory, entry.name));
      }),
    ];

    return candidateFiles.flatMap((filePath) => {
      const relativePath = path.relative(agentDir, filePath).replace(/\\/g, "/");
      const kind = classifyMemoryKind(relativePath);
      return require("node:fs")
        .readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .map((line: string, index: number) => ({
          path: relativePath,
          kind,
          line: index + 1,
          reason: `${kind} memory match`,
          text: line,
        }))
        .filter((entry: { text: string }) => entry.text.trim().length > 0);
    });
  }

  function syncIndex(agentId: string) {
    if (!params.store) {
      return 0;
    }
    return params.store.replaceMemoryIndex(agentId, buildIndexEntries(agentId));
  }

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
    syncIndex(agentId);
    if (params.store) {
      return params.store.searchMemoryIndex(agentId, query, maxResults);
    }
    return workspace.searchAgentMemory({
      agentId,
      query,
      maxResults,
    }).map((entry) => ({
      ...entry,
      kind: classifyMemoryKind(entry.path),
      score: 0,
      reason: `${classifyMemoryKind(entry.path)} memory match`,
    }));
  }

  function write(params: {
    agentId: string;
    content: string;
    target?: "durable" | "daily";
  }) {
    const result = workspace.appendAgentMemory(params);
    syncIndex(params.agentId);
    return result;
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
    const searchHits = tokens.length > 0 ? search(params.agentId, tokens.slice(0, 6).join(" "), 6) : [];

    const durableExcerpt = clip(snapshot.durableMemory.trim(), 1800);
    const dailyExcerpt = clip(snapshot.dailyMemory.trim(), 1400);
    const searchExcerpt = searchHits.length
      ? searchHits.map((hit) => `- ${hit.path}:${hit.line} (${hit.reason}) ${clip(hit.text, 220)}`).join("\n")
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
    conversationId?: string;
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

    const agentDir = workspace.createAgentWorkspace(params.agentId);
    const summaryFile = path.join(agentDir, "summaries", `${params.conversationId ?? "session"}.md`);
    const content = [
      `# ${params.conversationTitle}`,
      "",
      `User: ${clip(params.userMessage.trim(), 300)}`,
      "",
      `Assistant: ${clip(params.assistantText.trim(), 600)}`,
      "",
    ].join("\n");
    require("node:fs").writeFileSync(summaryFile, content, "utf8");
    syncIndex(params.agentId);
    return getSnapshot(params.agentId);
  }

  function captureOutcome(params: {
    agentId: string;
    taskTitle: string;
    assistantText: string;
  }) {
    const agentDir = workspace.createAgentWorkspace(params.agentId);
    const fileName = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
    const outcomeFile = path.join(agentDir, "outcomes", fileName);
    const content = [`# ${params.taskTitle}`, "", clip(params.assistantText.trim(), 2000), ""].join("\n");
    require("node:fs").writeFileSync(outcomeFile, content, "utf8");
    syncIndex(params.agentId);
    return outcomeFile;
  }

  function captureRememberRequest(params: {
    agentId: string;
    message: string;
  }) {
    const normalized = params.message.trim();
    if (!normalized) {
      return null;
    }

    if (!REMEMBER_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return null;
    }

    const cleaned = REMEMBER_CLEANUP_PATTERNS
      .reduce((current, pattern) => current.replace(pattern, ""), normalized)
      .trim()
      .replace(/^[:\-\s]+/u, "");

    if (!cleaned) {
      return null;
    }

    return write({
      agentId: params.agentId,
      target: "durable",
      content: cleaned,
    });
  }

  return {
    getSnapshot,
    getPlanningContext,
    search,
    syncIndex,
    write,
    flushSessionSummary,
    captureOutcome,
    captureRememberRequest,
  };
}
