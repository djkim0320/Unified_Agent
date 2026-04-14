import { z } from "zod";
import { searchDuckDuckGo } from "../lib/duckduckgo.js";
import { runWorkspaceCommand } from "../lib/exec-command.js";
import { fetchWebPage } from "../lib/web-fetch.js";
import type { RegisteredPlugin } from "../lib/plugin-manager.js";
import type { createToolRegistry } from "../lib/tool-registry.js";
import type { WorkspaceScope } from "../types.js";

const ScopeSchema = z.enum(["sandbox", "shared", "root"]).default("sandbox");

function clip(text: string, maxLength = 6000) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export const corePlugin: RegisteredPlugin = {
  manifest: {
    id: "core",
    name: "Core Tools",
    version: "1.0.0",
    description: "Built-in workspace, research, memory, task, and execution tools.",
    tools: [
      "list_tree",
      "read_file",
      "write_file",
      "edit_file",
      "make_dir",
      "move_path",
      "delete_path",
      "exec_command",
      "provider_web_search",
      "duckduckgo_search",
      "web_fetch",
      "browser_search",
      "browser_open",
      "browser_snapshot",
      "browser_extract",
      "browser_click",
      "browser_type",
      "browser_back",
      "browser_close",
      "memory_get",
      "memory_search",
      "memory_write",
      "spawn_subagent_session",
      "spawn_task",
      "schedule_task",
      "create_task_flow",
    ],
    skills: [
      {
        name: "workspace-runtime",
        content: [
          "# Core runtime guidance",
          "",
          "- Use sandbox files for session-specific work and shared only for intentionally shared artifacts.",
          "- Prefer provider_web_search or duckduckgo_search for simple research, web_fetch for a known URL, and browser_* for rendered pages.",
          "- When the user asks to remember a durable preference, call memory_write before answering.",
          "- Use standing orders and memory as durable operating context, not as a replacement for the current task.",
          "- Use spawn_subagent_session when a bounded child session can investigate or implement in parallel without blocking the parent transcript.",
          "- Use spawn_task for long-running detached work instead of blocking the foreground session.",
          "- Use create_task_flow when a multi-step background sequence should run in order with explicit dependencies.",
          "- Use schedule_task when the follow-up should happen later instead of immediately.",
          "- Nested spawned tasks are allowed only up to depth 2.",
          "- Use exec_command only with a direct program plus args. Raw shells are disabled unless unsafe mode is explicitly enabled.",
        ].join("\n"),
      },
    ],
  },
};

export function registerCoreTools(registry: ReturnType<typeof createToolRegistry>) {
  registry.register({
    name: "list_tree",
    description: "List files and folders in a workspace scope.",
    permission: "workspace",
    schema: z.object({
      scope: ScopeSchema.optional(),
      path: z.string().optional(),
      maxDepth: z.number().int().min(0).max(8).optional(),
    }),
    example: '{"type":"tool_call","tool":{"name":"list_tree","arguments":{"scope":"sandbox","path":".","maxDepth":3}}}',
    async execute({ arguments: args, conversationId, workspace }) {
      const scope = (args.scope as WorkspaceScope | undefined) ?? "sandbox";
      return {
        tree: workspace.listTree({
          conversationId,
          scope,
          relativePath: typeof args.path === "string" ? args.path : ".",
          maxDepth: typeof args.maxDepth === "number" ? args.maxDepth : 3,
        }),
      };
    },
  });

  registry.register({
    name: "read_file",
    description: "Read a text file from the workspace.",
    permission: "workspace",
    schema: z.object({
      scope: ScopeSchema.optional(),
      path: z.string().min(1),
    }),
    example: '{"type":"tool_call","tool":{"name":"read_file","arguments":{"scope":"sandbox","path":"notes.md"}}}',
    async execute({ arguments: args, conversationId, workspace }) {
      const scope = (args.scope as WorkspaceScope | undefined) ?? "sandbox";
      const file = workspace.readFile({
        conversationId,
        scope,
        relativePath: args.path as string,
      });
      return {
        path: file.path,
        binary: file.binary,
        unsupportedEncoding: file.unsupportedEncoding,
        encoding: file.encoding,
        text: file.binary ? "" : file.content,
      };
    },
  });

  registry.register({
    name: "write_file",
    description: "Write a text file inside the workspace.",
    permission: "workspace",
    schema: z.object({
      scope: ScopeSchema.optional(),
      path: z.string().min(1),
      content: z.string(),
    }),
    example: '{"type":"tool_call","tool":{"name":"write_file","arguments":{"scope":"sandbox","path":"notes.md","content":"hello"}}}',
    async execute({ arguments: args, conversationId, workspace }) {
      const scope = (args.scope as WorkspaceScope | undefined) ?? "sandbox";
      const relativePath = workspace.writeFile({
        conversationId,
        scope,
        relativePath: args.path as string,
        content: args.content as string,
      });
      return {
        path: relativePath,
        changedFiles: [relativePath],
      };
    },
  });

  registry.register({
    name: "edit_file",
    description: "Replace text inside a workspace file.",
    permission: "workspace",
    schema: z.object({
      scope: ScopeSchema.optional(),
      path: z.string().min(1),
      find: z.string().min(1),
      replace: z.string(),
      replaceAll: z.boolean().optional(),
    }),
    example: '{"type":"tool_call","tool":{"name":"edit_file","arguments":{"scope":"sandbox","path":"notes.md","find":"old","replace":"new"}}}',
    async execute({ arguments: args, conversationId, workspace }) {
      const scope = (args.scope as WorkspaceScope | undefined) ?? "sandbox";
      const relativePath = workspace.editFile({
        conversationId,
        scope,
        relativePath: args.path as string,
        find: args.find as string,
        replace: args.replace as string,
        replaceAll: Boolean(args.replaceAll),
      });
      return {
        path: relativePath,
        changedFiles: [relativePath],
      };
    },
  });

  registry.register({
    name: "make_dir",
    description: "Create a directory in the workspace.",
    permission: "workspace",
    schema: z.object({
      scope: ScopeSchema.optional(),
      path: z.string().min(1),
    }),
    example: '{"type":"tool_call","tool":{"name":"make_dir","arguments":{"scope":"sandbox","path":"research"}}}',
    async execute({ arguments: args, conversationId, workspace }) {
      const scope = (args.scope as WorkspaceScope | undefined) ?? "sandbox";
      const relativePath = workspace.makeDir({
        conversationId,
        scope,
        relativePath: args.path as string,
      });
      return { path: relativePath };
    },
  });

  registry.register({
    name: "move_path",
    description: "Move or rename a file inside the workspace.",
    permission: "workspace",
    schema: z.object({
      scope: ScopeSchema.optional(),
      from: z.string().min(1),
      to: z.string().min(1),
    }),
    example: '{"type":"tool_call","tool":{"name":"move_path","arguments":{"scope":"sandbox","from":"draft.md","to":"archive/draft.md"}}}',
    async execute({ arguments: args, conversationId, workspace }) {
      const scope = (args.scope as WorkspaceScope | undefined) ?? "sandbox";
      const relativePath = workspace.movePath({
        conversationId,
        scope,
        from: args.from as string,
        to: args.to as string,
      });
      return {
        path: relativePath,
        changedFiles: [relativePath],
      };
    },
  });

  registry.register({
    name: "delete_path",
    description: "Delete a file or directory inside the workspace.",
    permission: "workspace",
    schema: z.object({
      scope: ScopeSchema.optional(),
      path: z.string().min(1),
      recursive: z.boolean().optional(),
    }),
    example: '{"type":"tool_call","tool":{"name":"delete_path","arguments":{"scope":"sandbox","path":"tmp","recursive":true}}}',
    async execute({ arguments: args, conversationId, workspace }) {
      const scope = (args.scope as WorkspaceScope | undefined) ?? "sandbox";
      workspace.deletePath({
        conversationId,
        scope,
        relativePath: args.path as string,
        recursive: Boolean(args.recursive),
      });
      return {
        path: args.path as string,
        deleted: true,
        changedFiles: [args.path as string],
      };
    },
  });

  registry.register({
    name: "exec_command",
    description: "Run a structured command in the session sandbox using a direct program plus args.",
    permission: "exec",
    schema: z.object({
      program: z.string().min(1),
      args: z.array(z.string()).optional(),
      cwd: z.string().min(1).optional(),
      timeoutMs: z.number().int().min(1).max(120_000).optional(),
    }),
    example: '{"type":"tool_call","tool":{"name":"exec_command","arguments":{"program":"node","args":["--version"],"cwd":".","timeoutMs":10000}}}',
    async execute({ arguments: args, conversationId, workspace, signal, unsafeShellEnabled }) {
      const cwd = workspace.resolveSandboxDirectory({
        conversationId,
        relativePath: typeof args.cwd === "string" ? args.cwd : ".",
      });
      const result = await runWorkspaceCommand({
        program: args.program as string,
        args: Array.isArray(args.args) ? (args.args as string[]) : [],
        timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
        cwd: cwd.absolutePath,
        signal,
        allowUnsafeShell: unsafeShellEnabled,
      });
      return {
        program: args.program,
        args: args.args ?? [],
        cwd: cwd.relativePath,
        exitCode: result.exitCode,
        stdout: clip(result.stdout, 5000),
        stderr: clip(result.stderr, 3000),
        timedOut: result.timedOut,
      };
    },
  });

  registry.register({
    name: "provider_web_search",
    description: "Use the current provider's native web search when available.",
    permission: "network",
    schema: z.object({
      query: z.string().min(1),
    }),
    example: '{"type":"tool_call","tool":{"name":"provider_web_search","arguments":{"query":"latest release notes"}}}',
    async execute({ arguments: args, adapter, secret, model, signal }) {
      if (!adapter.searchWeb) {
        throw new Error("Current provider does not support provider_web_search.");
      }
      return adapter.searchWeb({
        secret,
        model,
        query: args.query as string,
        signal,
      });
    },
  });

  registry.register({
    name: "duckduckgo_search",
    description: "Run a free HTML DuckDuckGo search as a fallback research backend.",
    permission: "network",
    schema: z.object({
      query: z.string().min(1),
      maxResults: z.number().int().min(1).max(10).optional(),
    }),
    example: '{"type":"tool_call","tool":{"name":"duckduckgo_search","arguments":{"query":"playwright browser context isolation","maxResults":5}}}',
    async execute({ arguments: args }) {
      return {
        query: args.query,
        results: await searchDuckDuckGo(
          args.query as string,
          typeof args.maxResults === "number" ? args.maxResults : 5,
        ),
      };
    },
  });

  registry.register({
    name: "web_fetch",
    description: "Fetch and extract plain text from a known URL.",
    permission: "network",
    schema: z.object({
      url: z.string().url(),
    }),
    example: '{"type":"tool_call","tool":{"name":"web_fetch","arguments":{"url":"https://example.com"}}}',
    async execute({ arguments: args, signal }) {
      return fetchWebPage(args.url as string, { signal });
    },
  });

  registry.register({
    name: "browser_search",
    description: "Search the web in a Chromium browser session.",
    permission: "browser",
    schema: z.object({
      query: z.string().min(1),
    }),
    example: '{"type":"tool_call","tool":{"name":"browser_search","arguments":{"query":"sqlite pragma foreign_keys explained"}}}',
    async execute({ arguments: args, runId, conversationId, browserRuntime, signal }) {
      return browserRuntime.search({
        sessionId: runId,
        conversationId,
        query: args.query as string,
        signal,
      });
    },
  });

  registry.register({
    name: "browser_open",
    description: "Open a specific URL in the browser session.",
    permission: "browser",
    schema: z.object({
      url: z.string().url(),
    }),
    example: '{"type":"tool_call","tool":{"name":"browser_open","arguments":{"url":"https://example.com"}}}',
    async execute({ arguments: args, runId, conversationId, browserRuntime, signal }) {
      return browserRuntime.open({
        sessionId: runId,
        conversationId,
        url: args.url as string,
        signal,
      });
    },
  });

  registry.register({
    name: "browser_snapshot",
    description: "Get a bounded plain-text snapshot of the current page.",
    permission: "browser",
    schema: z.object({}),
    example: '{"type":"tool_call","tool":{"name":"browser_snapshot","arguments":{}}}',
    async execute({ runId, conversationId, browserRuntime }) {
      return browserRuntime.snapshot({
        sessionId: runId,
        conversationId,
      });
    },
  });

  registry.register({
    name: "browser_extract",
    description: "Extract plain text from the current page or a selector.",
    permission: "browser",
    schema: z.object({
      selector: z.string().optional(),
    }),
    example: '{"type":"tool_call","tool":{"name":"browser_extract","arguments":{"selector":"main"}}}',
    async execute({ arguments: args, runId, conversationId, browserRuntime }) {
      return browserRuntime.extract({
        sessionId: runId,
        conversationId,
        selector: typeof args.selector === "string" ? args.selector : undefined,
      });
    },
  });

  registry.register({
    name: "browser_click",
    description: "Click an element in the current browser page.",
    permission: "browser",
    schema: z.object({
      selector: z.string().min(1),
    }),
    example: '{"type":"tool_call","tool":{"name":"browser_click","arguments":{"selector":"button"}}}',
    async execute({ arguments: args, runId, conversationId, browserRuntime, signal }) {
      return browserRuntime.click({
        sessionId: runId,
        conversationId,
        selector: args.selector as string,
        signal,
      });
    },
  });

  registry.register({
    name: "browser_type",
    description: "Type into an input in the current browser page.",
    permission: "browser",
    schema: z.object({
      selector: z.string().min(1),
      text: z.string(),
      submit: z.boolean().optional(),
    }),
    example: '{"type":"tool_call","tool":{"name":"browser_type","arguments":{"selector":"input[name=q]","text":"query","submit":true}}}',
    async execute({ arguments: args, runId, conversationId, browserRuntime, signal }) {
      return browserRuntime.type({
        sessionId: runId,
        conversationId,
        selector: args.selector as string,
        text: args.text as string,
        submit: Boolean(args.submit),
        signal,
      });
    },
  });

  registry.register({
    name: "browser_back",
    description: "Go back in the current browser session.",
    permission: "browser",
    schema: z.object({}),
    example: '{"type":"tool_call","tool":{"name":"browser_back","arguments":{}}}',
    async execute({ runId, conversationId, browserRuntime, signal }) {
      return browserRuntime.back({
        sessionId: runId,
        conversationId,
        signal,
      });
    },
  });

  registry.register({
    name: "browser_close",
    description: "Close the current browser session.",
    permission: "browser",
    schema: z.object({}),
    example: '{"type":"tool_call","tool":{"name":"browser_close","arguments":{}}}',
    async execute({ runId, browserRuntime }) {
      await browserRuntime.closeSession(runId);
      return { closed: true };
    },
  });

  registry.register({
    name: "memory_get",
    description: "Read the agent durable memory and today's note.",
    permission: "memory",
    schema: z.object({}),
    example: '{"type":"tool_call","tool":{"name":"memory_get","arguments":{}}}',
    async execute({ agentId, memoryManager }) {
      const snapshot = memoryManager.getSnapshot(agentId);
      return { ...snapshot };
    },
  });

  registry.register({
    name: "memory_search",
    description: "Search the agent's local memory files.",
    permission: "memory",
    schema: z.object({
      query: z.string().min(1),
      maxResults: z.number().int().min(1).max(12).optional(),
    }),
    example: '{"type":"tool_call","tool":{"name":"memory_search","arguments":{"query":"preferred coding style","maxResults":5}}}',
    async execute({ agentId, memoryManager, arguments: args }) {
      return {
        query: args.query,
        results: memoryManager.search(
          agentId,
          args.query as string,
          typeof args.maxResults === "number" ? args.maxResults : 8,
        ),
      };
    },
  });

  registry.register({
    name: "memory_write",
    description: "Append a durable or daily memory entry for the current agent.",
    permission: "memory",
    schema: z.object({
      content: z.string().min(1),
      target: z.enum(["durable", "daily"]).optional(),
    }),
    example: '{"type":"tool_call","tool":{"name":"memory_write","arguments":{"content":"The user prefers concise Korean UI copy.","target":"durable"}}}',
    async execute({ agentId, memoryManager, arguments: args }) {
      const snapshot = memoryManager.write({
        agentId,
        content: args.content as string,
        target: (args.target as "durable" | "daily" | undefined) ?? "durable",
      });
      return {
        saved: true,
        durableMemoryPath: "MEMORY.md",
        dailyMemoryPath: snapshot.date ? `memory/${snapshot.date}.md` : "memory",
      };
    },
  });

  registry.register({
    name: "spawn_subagent_session",
    description: "Spawn a child session that works in parallel and reports back into the parent session.",
    permission: "tasks",
    risk: "medium",
    costHint: "moderate",
    concurrencyClass: "exclusive",
    batchable: false,
    rolePolicy: {
      allowPrimary: true,
      allowSubagent: true,
      maxNestingDepth: 2,
    },
    audit: {
      category: "subagent",
      safeByDefault: true,
    },
    schema: z.object({
      prompt: z.string().min(1),
      title: z.string().min(1).optional(),
      providerKind: z.enum(["openai", "anthropic", "gemini", "ollama", "openai-codex"]).optional(),
      model: z.string().min(1).optional(),
      reasoningLevel: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
    }),
    example:
      '{"type":"tool_call","tool":{"name":"spawn_subagent_session","arguments":{"title":"Investigate tests","prompt":"Inspect the failing tests and summarize the root cause."}}}',
    async execute({
      arguments: args,
      agentId,
      conversationId,
      runId,
      sessionManager,
      adapter,
      model,
      reasoningLevel,
    }) {
      if (!sessionManager) {
        throw new Error("Sub-agent session manager is unavailable.");
      }
      const created = await sessionManager.spawnSubagentSession({
        agentId,
        parentConversationId: conversationId,
        parentRunId: runId,
        prompt: args.prompt as string,
        title: typeof args.title === "string" ? args.title : undefined,
        providerKind: (args.providerKind as typeof adapter.kind | undefined) ?? adapter.kind,
        model: typeof args.model === "string" ? (args.model as string) : model,
        reasoningLevel:
          (args.reasoningLevel as typeof reasoningLevel | undefined) ?? reasoningLevel,
      });
      return {
        sessionId: created.session.id,
        taskId: created.task.id,
        title: created.session.title,
        providerKind: created.session.providerKind,
        model: created.session.model,
        reasoningLevel: created.session.reasoningLevel,
      };
    },
  });

  registry.register({
    name: "spawn_task",
    description: "Queue a detached background task for the current agent and session.",
    permission: "tasks",
    schema: z.object({
      prompt: z.string().min(1),
      title: z.string().min(1).optional(),
    }),
    example: '{"type":"tool_call","tool":{"name":"spawn_task","arguments":{"title":"Long research","prompt":"Research the latest Playwright browser isolation best practices and summarize them."}}}',
    async execute({
      arguments: args,
      agentId,
      conversationId,
      taskManager,
      adapter,
      model,
      reasoningLevel,
      currentTaskId,
      nestingDepth,
    }) {
      if (!taskManager) {
        throw new Error("Task manager is unavailable.");
      }
      const nextDepth = (nestingDepth ?? 0) + 1;
      if (nextDepth > 2) {
        throw new Error("Nested tasks are limited to depth 2.");
      }
      const task = await taskManager.enqueueDetachedTask({
        agentId,
        conversationId,
        prompt: args.prompt as string,
        title: typeof args.title === "string" ? args.title : undefined,
        providerKind: adapter.kind,
        model,
        reasoningLevel,
        taskKind: "detached",
        parentTaskId: currentTaskId ?? null,
        nestingDepth: nextDepth,
      });
      return {
        taskId: task.id,
        status: "queued",
      };
    },
  });

  registry.register({
    name: "create_task_flow",
    description: "Create a multi-step background flow with ordered dependencies.",
    permission: "tasks",
    risk: "medium",
    costHint: "moderate",
    concurrencyClass: "exclusive",
    batchable: false,
    rolePolicy: {
      allowPrimary: true,
      allowSubagent: true,
      maxNestingDepth: 2,
    },
    audit: {
      category: "automation",
      safeByDefault: true,
    },
    schema: z.object({
      title: z.string().min(1),
      steps: z
        .array(
          z.object({
            stepKey: z.string().min(1),
            title: z.string().min(1),
            prompt: z.string().min(1),
            dependencyStepKey: z.string().min(1).optional(),
          }),
        )
        .min(1)
        .max(8),
    }),
    example:
      '{"type":"tool_call","tool":{"name":"create_task_flow","arguments":{"title":"Ship patch","steps":[{"stepKey":"inspect","title":"Inspect repo","prompt":"Inspect the relevant files."},{"stepKey":"implement","title":"Implement changes","prompt":"Make the required changes.","dependencyStepKey":"inspect"}]}}}',
    async execute({ arguments: args, agentId, conversationId, flowManager, runId }) {
      if (!flowManager) {
        throw new Error("Task flow manager is unavailable.");
      }
      const created = await flowManager.createFlow({
        agentId,
        conversationId,
        title: args.title as string,
        originRunId: runId,
        steps: (args.steps as Array<{
          stepKey: string;
          title: string;
          prompt: string;
          dependencyStepKey?: string;
        }>).map((step) => ({
          stepKey: step.stepKey,
          title: step.title,
          prompt: step.prompt,
          dependencyStepKey: step.dependencyStepKey ?? null,
        })),
      });
      return {
        flowId: created.flow.id,
        status: created.flow.status,
        steps: created.steps.map((step) => ({
          id: step.id,
          stepKey: step.stepKey,
          status: step.status,
        })),
      };
    },
  });

  registry.register({
    name: "schedule_task",
    description: "Schedule a background task for later execution.",
    permission: "tasks",
    schema: z.object({
      prompt: z.string().min(1),
      title: z.string().min(1).optional(),
      delayMs: z.number().int().min(1).max(7 * 24 * 60 * 60 * 1000).optional(),
      scheduledFor: z.number().int().min(0).optional(),
    }),
    example: '{"type":"tool_call","tool":{"name":"schedule_task","arguments":{"title":"Follow up later","prompt":"Check whether the workspace diff is clean.","delayMs":600000}}}',
    async execute({
      arguments: args,
      agentId,
      conversationId,
      taskManager,
      adapter,
      model,
      reasoningLevel,
      currentTaskId,
      nestingDepth,
    }) {
      if (!taskManager) {
        throw new Error("Task manager is unavailable.");
      }
      const nextDepth = (nestingDepth ?? 0) + 1;
      if (nextDepth > 2) {
        throw new Error("Nested tasks are limited to depth 2.");
      }
      const scheduledFor =
        typeof args.scheduledFor === "number"
          ? args.scheduledFor
          : typeof args.delayMs === "number"
            ? Date.now() + args.delayMs
            : null;
      if (scheduledFor == null) {
        throw new Error("schedule_task requires delayMs or scheduledFor.");
      }
      const task = await taskManager.enqueueDetachedTask({
        agentId,
        conversationId,
        prompt: args.prompt as string,
        title: typeof args.title === "string" ? args.title : undefined,
        providerKind: adapter.kind,
        model,
        reasoningLevel,
        taskKind: "scheduled",
        parentTaskId: currentTaskId ?? null,
        nestingDepth: nextDepth,
        scheduledFor,
        startImmediately: false,
      });
      return {
        taskId: task.id,
        status: "queued",
        scheduledFor,
      };
    },
  });
}
