import path from "node:path";
import { z } from "zod";
import { searchDuckDuckGo } from "./duckduckgo.js";
import { runWorkspaceCommand } from "./exec-command.js";
import { fetchWebPage } from "./web-fetch.js";
import type { createBrowserRuntime } from "./browser-runtime.js";
import type { createWorkspaceManager } from "./workspace.js";
import type { ProviderAdapter } from "../providers/base.js";
import type {
  ChatMessage,
  ProviderKind,
  ProviderSecret,
  ReasoningLevel,
  SearchBackendAvailability,
  ToolCall,
  ToolName,
  WorkspaceRunEventRecord,
  WorkspaceScope,
} from "../types.js";

const ScopeSchema = z.enum(["sandbox", "shared", "root"]).default("sandbox");

const ToolArgumentSchemas: Record<ToolName, z.ZodType<Record<string, unknown>>> = {
  list_tree: z.object({
    scope: ScopeSchema.optional(),
    path: z.string().optional(),
    maxDepth: z.number().int().min(0).max(8).optional(),
  }),
  read_file: z.object({
    scope: ScopeSchema.optional(),
    path: z.string().min(1),
  }),
  write_file: z.object({
    scope: ScopeSchema.optional(),
    path: z.string().min(1),
    content: z.string(),
  }),
  edit_file: z.object({
    scope: ScopeSchema.optional(),
    path: z.string().min(1),
    find: z.string().min(1),
    replace: z.string(),
    replaceAll: z.boolean().optional(),
  }),
  make_dir: z.object({
    scope: ScopeSchema.optional(),
    path: z.string().min(1),
  }),
  move_path: z.object({
    scope: ScopeSchema.optional(),
    from: z.string().min(1),
    to: z.string().min(1),
  }),
  delete_path: z.object({
    scope: ScopeSchema.optional(),
    path: z.string().min(1),
    recursive: z.boolean().optional(),
  }),
  exec_command: z.object({
    command: z.string().min(1),
  }),
  provider_web_search: z.object({
    query: z.string().min(1),
  }),
  duckduckgo_search: z.object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(10).optional(),
  }),
  web_fetch: z.object({
    url: z.string().url(),
  }),
  browser_search: z.object({
    query: z.string().min(1),
  }),
  browser_open: z.object({
    url: z.string().url(),
  }),
  browser_snapshot: z.object({}),
  browser_extract: z.object({
    selector: z.string().optional(),
  }),
  browser_click: z.object({
    selector: z.string().min(1),
  }),
  browser_type: z.object({
    selector: z.string().min(1),
    text: z.string(),
    submit: z.boolean().optional(),
  }),
  browser_back: z.object({}),
  browser_close: z.object({}),
};

function clipText(text: string, maxLength = 4000) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function relativeFromSandbox(sandboxDir: string, absolutePath: string) {
  return path.relative(sandboxDir, absolutePath).replace(/\\/g, "/");
}

function toolStatusLabel(toolName: ToolName) {
  if (toolName.includes("search")) {
    return "검색 중";
  }
  if (toolName.startsWith("browser_")) {
    return "브라우저 조사 중";
  }
  if (toolName === "exec_command") {
    return "명령 실행 중";
  }
  return "파일 수정 중";
}

function formatSearchBackends(backends: SearchBackendAvailability[]) {
  return backends
    .map(
      (backend) =>
        `- ${backend.kind}: ${backend.enabled ? "enabled" : "disabled"} (${backend.note ?? backend.label})`,
    )
    .join("\n");
}

function buildToolInstructions() {
  return [
    "Return strict JSON only.",
    "Valid shapes:",
    '- {"type":"tool_call","tool":{"name":"list_tree","arguments":{"scope":"sandbox","path":".","maxDepth":3}}}',
    '- {"type":"tool_call","tool":{"name":"read_file","arguments":{"scope":"sandbox","path":"notes.md"}}}',
    '- {"type":"tool_call","tool":{"name":"write_file","arguments":{"scope":"sandbox","path":"notes.md","content":"..."}}}',
    '- {"type":"tool_call","tool":{"name":"edit_file","arguments":{"scope":"sandbox","path":"notes.md","find":"old","replace":"new","replaceAll":false}}}',
    '- {"type":"tool_call","tool":{"name":"make_dir","arguments":{"scope":"sandbox","path":"research"}}}',
    '- {"type":"tool_call","tool":{"name":"move_path","arguments":{"scope":"sandbox","from":"a.txt","to":"archive/a.txt"}}}',
    '- {"type":"tool_call","tool":{"name":"delete_path","arguments":{"scope":"sandbox","path":"tmp","recursive":true}}}',
    '- {"type":"tool_call","tool":{"name":"exec_command","arguments":{"command":"Get-ChildItem"}}}',
    '- {"type":"tool_call","tool":{"name":"provider_web_search","arguments":{"query":"..."}}}',
    '- {"type":"tool_call","tool":{"name":"duckduckgo_search","arguments":{"query":"...","maxResults":5}}}',
    '- {"type":"tool_call","tool":{"name":"web_fetch","arguments":{"url":"https://example.com"}}}',
    '- {"type":"tool_call","tool":{"name":"browser_search","arguments":{"query":"..."}}}',
    '- {"type":"tool_call","tool":{"name":"browser_open","arguments":{"url":"https://example.com"}}}',
    '- {"type":"tool_call","tool":{"name":"browser_snapshot","arguments":{}}}',
    '- {"type":"tool_call","tool":{"name":"browser_extract","arguments":{"selector":"main"}}}',
    '- {"type":"tool_call","tool":{"name":"browser_click","arguments":{"selector":"button"}}}',
    '- {"type":"tool_call","tool":{"name":"browser_type","arguments":{"selector":"input[name=q]","text":"query","submit":true}}}',
    '- {"type":"tool_call","tool":{"name":"browser_back","arguments":{}}}',
    '- {"type":"tool_call","tool":{"name":"browser_close","arguments":{}}}',
    '- {"type":"final_answer"}',
    "Use only one tool per step.",
    "Do not invent tool results.",
    "Prefer provider_web_search or duckduckgo_search for ordinary search, web_fetch for a direct URL, and browser tools for pages that need rendering or interaction.",
  ].join("\n");
}

function buildPlanningInstructions(params: {
  guides: { agents: string; memory: string; user: string; tools: string };
  stepIndex: number;
  searchBackends: SearchBackendAvailability[];
  sandboxDir: string;
  toolHistory: Array<{ tool: string; result: string }>;
}) {
  const historyBlock = params.toolHistory.length
    ? params.toolHistory
        .map(
          (entry, index) =>
            `Step ${index + 1} - ${entry.tool}\n${clipText(entry.result, 2500)}`,
        )
        .join("\n\n")
    : "No tool calls have been made yet.";

  return [
    "You are an autonomous workspace agent inside a local multi-provider chat app.",
    "The server will execute tools on your behalf.",
    "Stop and return final_answer when you have enough information to answer the user well.",
    "",
    `Current planning step: ${params.stepIndex + 1} / 8`,
    `Conversation sandbox: ${params.sandboxDir}`,
    "",
    "Available search backends:",
    formatSearchBackends(params.searchBackends),
    "",
    "Workspace guides:",
    params.guides.agents,
    "",
    params.guides.memory,
    "",
    params.guides.user,
    "",
    params.guides.tools,
    "",
    "Previous tool results:",
    historyBlock,
    "",
    buildToolInstructions(),
  ].join("\n");
}

function buildFinalInstructions(params: {
  guides: { agents: string; memory: string; user: string; tools: string };
  toolHistory: Array<{ tool: string; result: string }>;
  changedFiles: string[];
}) {
  const changes = params.changedFiles.length
    ? params.changedFiles.map((file) => `- ${file}`).join("\n")
    : "- No workspace files changed.";
  const history = params.toolHistory.length
    ? params.toolHistory
        .map((entry, index) => `Step ${index + 1}: ${entry.tool}\n${clipText(entry.result, 1400)}`)
        .join("\n\n")
    : "No tools were used.";

  return [
    "You are the assistant in a local autonomous workspace chat app.",
    "Answer in the user's language.",
    "Summarize the work performed and the outcome.",
    "If files changed, mention them briefly.",
    "Do not claim actions that were not performed.",
    "",
    params.guides.agents,
    "",
    "Tool history:",
    history,
    "",
    "Changed files:",
    changes,
  ].join("\n");
}

function buildToolSummary(toolCall: ToolCall, result: Record<string, unknown>) {
  return JSON.stringify(
    {
      tool: toolCall.name,
      arguments: toolCall.arguments,
      result,
    },
    null,
    2,
  );
}

export async function runAgentTurn<K extends ProviderKind>(params: {
  adapter: ProviderAdapter<K>;
  secret: ProviderSecret<K>;
  providerKind: ProviderKind;
  model: string;
  reasoningLevel: ReasoningLevel;
  conversationId: string;
  userMessage: string;
  messages: ChatMessage[];
  workspace: ReturnType<typeof createWorkspaceManager>;
  browserRuntime: ReturnType<typeof createBrowserRuntime>;
  store: {
    createWorkspaceRun: (input: {
      conversationId: string;
      providerKind: ProviderKind;
      model: string;
      userMessage: string;
    }) => { id: string };
    appendWorkspaceRunEvent: (input: {
      runId: string;
      eventType: WorkspaceRunEventRecord["eventType"];
      payload: Record<string, unknown>;
    }) => WorkspaceRunEventRecord;
    completeWorkspaceRun: (id: string, status: "completed" | "failed") => unknown;
  };
  sendEvent: (eventName: string, payload: Record<string, unknown>) => void;
}) {
  const run = params.store.createWorkspaceRun({
    conversationId: params.conversationId,
    providerKind: params.providerKind,
    model: params.model,
    userMessage: params.userMessage,
  });
  const guides = params.workspace.readGuides();
  const sandboxDir = params.workspace.getSandboxDir(params.conversationId);
  const searchBackends: SearchBackendAvailability[] = [
    {
      kind: "provider_web_search",
      enabled: Boolean(params.adapter.searchWeb),
      label: `${params.adapter.label} web search`,
      note: params.adapter.searchWeb ? null : "Current provider does not expose native web search.",
    },
    {
      kind: "duckduckgo_search",
      enabled: true,
      label: "DuckDuckGo HTML search",
      note: "Key-free fallback search backend.",
    },
    {
      kind: "browser_search",
      enabled: true,
      label: "Chromium browser research",
      note: "Use for rendered or interactive pages.",
    },
    {
      kind: "web_fetch",
      enabled: true,
      label: "Direct URL fetch",
      note: "Use for a known article URL.",
    },
  ];

  const toolHistory: Array<{ tool: string; result: string }> = [];
  const changedFiles = new Set<string>();

  const emit = (eventType: WorkspaceRunEventRecord["eventType"], payload: Record<string, unknown>) => {
    params.store.appendWorkspaceRunEvent({
      runId: run.id,
      eventType,
      payload,
    });
  };

  try {
    for (let stepIndex = 0; stepIndex < 8; stepIndex += 1) {
      const instructions = buildPlanningInstructions({
        guides,
        stepIndex,
        searchBackends,
        sandboxDir,
        toolHistory,
      });
      const step = await params.adapter.planToolStep({
        secret: params.secret,
        model: params.model,
        reasoningLevel: params.reasoningLevel,
        instructions,
        messages: params.messages,
      });

      if (step.type === "final_answer") {
        break;
      }

      const status = toolStatusLabel(step.tool.name);
      emit("status", { message: status, tool: step.tool.name });
      params.sendEvent("status", { message: status, tool: step.tool.name });
      emit("tool_call", {
        tool: step.tool.name,
        arguments: step.tool.arguments,
      });
      params.sendEvent("tool_call", {
        tool: step.tool.name,
        arguments: step.tool.arguments,
      });

      const result = (await executeTool({
        toolCall: step.tool,
        conversationId: params.conversationId,
        workspace: params.workspace,
        browserRuntime: params.browserRuntime,
        adapter: params.adapter,
        secret: params.secret,
        model: params.model,
        sandboxDir,
      })) as Record<string, unknown>;

      const changedFilesInResult = Array.isArray(result.changedFiles)
        ? result.changedFiles.filter((value): value is string => typeof value === "string")
        : [];

      if (changedFilesInResult.length) {
        for (const file of changedFilesInResult) {
          changedFiles.add(file);
        }
      }

      const compactResult = {
        ...result,
        text: typeof result.text === "string" ? clipText(result.text, 5000) : result.text,
      };

      emit("tool_result", {
        tool: step.tool.name,
        result: compactResult,
      });
      params.sendEvent("tool_result", {
        tool: step.tool.name,
        result: compactResult,
      });
      toolHistory.push({
        tool: step.tool.name,
        result: buildToolSummary(step.tool, compactResult),
      });
    }

    const finalInstructions = buildFinalInstructions({
      guides,
      toolHistory,
      changedFiles: [...changedFiles].sort(),
    });

    let assistantText = "";
    await params.adapter.streamFinalAnswer({
      secret: params.secret,
      model: params.model,
      reasoningLevel: params.reasoningLevel,
      instructions: finalInstructions,
      messages: params.messages,
      onText: (chunk) => {
        assistantText += chunk;
        params.sendEvent("delta", { delta: chunk });
      },
    });

    emit("run_complete", {
      changedFiles: [...changedFiles].sort(),
    });
    params.sendEvent("run_complete", {
      runId: run.id,
      changedFiles: [...changedFiles].sort(),
    });
    params.store.completeWorkspaceRun(run.id, "completed");

    return {
      runId: run.id,
      assistantText,
      changedFiles: [...changedFiles].sort(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent runtime failed.";
    emit("error", { error: message });
    params.store.completeWorkspaceRun(run.id, "failed");
    throw error;
  }
}

async function executeTool<K extends ProviderKind>(params: {
  toolCall: ToolCall;
  conversationId: string;
  workspace: ReturnType<typeof createWorkspaceManager>;
  browserRuntime: ReturnType<typeof createBrowserRuntime>;
  adapter: ProviderAdapter<K>;
  secret: ProviderSecret<K>;
  model: string;
  sandboxDir: string;
}) {
  const parser = ToolArgumentSchemas[params.toolCall.name];
  const args = parser.parse(params.toolCall.arguments);

  const scope = ("scope" in args ? (args.scope as WorkspaceScope | undefined) : undefined) ?? "sandbox";

  switch (params.toolCall.name) {
    case "list_tree": {
      const tree = params.workspace.listTree({
        conversationId: params.conversationId,
        scope,
        relativePath: typeof args.path === "string" ? args.path : ".",
        maxDepth: typeof args.maxDepth === "number" ? args.maxDepth : 3,
      });
      return { tree };
    }
    case "read_file": {
      const file = params.workspace.readFile({
        conversationId: params.conversationId,
        scope,
        relativePath: args.path as string,
      });
      return {
        path: file.path,
        binary: file.binary,
        text: file.binary ? "" : file.content,
      };
    }
    case "write_file": {
      const absolutePath = params.workspace.writeFile({
        conversationId: params.conversationId,
        scope,
        relativePath: args.path as string,
        content: args.content as string,
      });
      return {
        path: relativeFromSandbox(params.sandboxDir, absolutePath),
        changedFiles: [relativeFromSandbox(params.sandboxDir, absolutePath)],
      };
    }
    case "edit_file": {
      params.workspace.editFile({
        conversationId: params.conversationId,
        scope,
        relativePath: args.path as string,
        find: args.find as string,
        replace: args.replace as string,
        replaceAll: Boolean(args.replaceAll),
      });
      return {
        path: args.path as string,
        changedFiles: [String(args.path)],
      };
    }
    case "make_dir": {
      const absolutePath = params.workspace.makeDir({
        conversationId: params.conversationId,
        scope,
        relativePath: args.path as string,
      });
      return {
        path: relativeFromSandbox(params.sandboxDir, absolutePath),
      };
    }
    case "move_path": {
      const absolutePath = params.workspace.movePath({
        conversationId: params.conversationId,
        scope,
        from: args.from as string,
        to: args.to as string,
      });
      return {
        path: relativeFromSandbox(params.sandboxDir, absolutePath),
        changedFiles: [String(args.to)],
      };
    }
    case "delete_path": {
      params.workspace.deletePath({
        conversationId: params.conversationId,
        scope,
        relativePath: args.path as string,
        recursive: Boolean(args.recursive),
      });
      return {
        path: args.path as string,
        deleted: true,
        changedFiles: [String(args.path)],
      };
    }
    case "exec_command": {
      const result = await runWorkspaceCommand({
        command: args.command as string,
        cwd: params.sandboxDir,
      });
      return {
        command: args.command,
        exitCode: result.exitCode,
        stdout: clipText(result.stdout, 5000),
        stderr: clipText(result.stderr, 3000),
      };
    }
    case "provider_web_search": {
      if (!params.adapter.searchWeb) {
        throw new Error("Current provider does not support provider_web_search.");
      }
      return await params.adapter.searchWeb({
        secret: params.secret,
        model: params.model,
        query: args.query as string,
      });
    }
    case "duckduckgo_search": {
      const results = await searchDuckDuckGo(
        args.query as string,
        typeof args.maxResults === "number" ? args.maxResults : 5,
      );
      return {
        query: args.query,
        results,
      };
    }
    case "web_fetch": {
      return await fetchWebPage(args.url as string);
    }
    case "browser_search": {
      return await params.browserRuntime.search(params.conversationId, args.query as string);
    }
    case "browser_open": {
      return await params.browserRuntime.open(params.conversationId, args.url as string);
    }
    case "browser_snapshot": {
      return await params.browserRuntime.snapshot(params.conversationId);
    }
    case "browser_extract": {
      return await params.browserRuntime.extract(
        params.conversationId,
        typeof args.selector === "string" ? args.selector : undefined,
      );
    }
    case "browser_click": {
      return await params.browserRuntime.click(params.conversationId, args.selector as string);
    }
    case "browser_type": {
      return await params.browserRuntime.type(
        params.conversationId,
        args.selector as string,
        args.text as string,
        Boolean(args.submit),
      );
    }
    case "browser_back": {
      return await params.browserRuntime.back(params.conversationId);
    }
    case "browser_close": {
      await params.browserRuntime.closeSession(params.conversationId);
      return { closed: true };
    }
  }
}
