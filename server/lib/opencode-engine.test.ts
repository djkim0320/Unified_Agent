import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "../db.js";
import {
  createOpenCodeEngine,
  buildOpenCodeEnvironment,
  openCodeEngineTestUtils,
  type OpenCodeCommandRunner,
} from "./opencode-engine.js";
import { buildOpenCodeCredentialSync, modelForOpenCode } from "./opencode-credentials.js";
import { resolveOpenCodeLauncher } from "./opencode-launcher.js";
import { createWorkspaceManager } from "./workspace.js";
import { EngineRunError } from "./agent-engine.js";

describe("OpenCodeEngine", () => {
  let projectRoot: string;
  let dataDir: string;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aetherops-opencode-"));
    dataDir = path.join(projectRoot, ".data");
    store = createStore(dataDir);
  });

  afterEach(() => {
    store.rawDb.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  function createConversation() {
    const agent = store.getDefaultAgent();
    const conversation = store.saveConversation({
      agentId: agent.id,
      title: "Engine session",
      providerKind: "openai",
      model: "gpt-5.5",
      reasoningLevel: "high",
    });
    store.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Create a note.",
    });
    return { agent, conversation };
  }

  it("does not forward host provider secrets into the opencode environment", () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-should-not-leak";
    try {
      const env = buildOpenCodeEnvironment();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.OPENCODE_DISABLE_AUTOUPDATE).toBe("true");
      expect(env.OPENCODE_DISABLE_PRUNE).toBe("true");
      expect(env.OPENCODE_DISABLE_DEFAULT_PLUGINS).toBe("true");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });

  it("keeps opencode permission bypass opt-in and testable", () => {
    expect(openCodeEngineTestUtils.shouldAutoApproveOpenCodePermissions({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      openCodeEngineTestUtils.shouldAutoApproveOpenCodePermissions({
        AETHEROPS_OPENCODE_AUTO_APPROVE: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      openCodeEngineTestUtils.shouldAutoApproveOpenCodePermissions({
        AETHEROPS_OPENCODE_DANGEROUS_SKIP_PERMISSIONS: "1",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("builds runtime-only opencode credential config from AetherOps provider secrets", () => {
    const credentialSync = buildOpenCodeCredentialSync({
      selectedProviderKind: "openai",
      selectedModel: "gpt-5.5",
      secrets: {
        openai: { apiKey: "sk-runtime-only" },
        anthropic: { apiKey: "anthropic-runtime-only" },
        gemini: { apiKey: "gemini-runtime-only" },
        ollama: { baseUrl: "http://127.0.0.1:11434" },
      },
    });
    const env = buildOpenCodeEnvironment({ credentialSync });

    expect(env.AETHEROPS_OPENAI_API_KEY).toBe("sk-runtime-only");
    expect(env.AETHEROPS_ANTHROPIC_API_KEY).toBe("anthropic-runtime-only");
    expect(env.AETHEROPS_GEMINI_API_KEY).toBe("gemini-runtime-only");
    expect(env.GOOGLE_GENERATIVE_AI_API_KEY).toBe("gemini-runtime-only");
    expect(env.OPENCODE_CONFIG_CONTENT).toContain("{env:AETHEROPS_OPENAI_API_KEY}");
    expect(env.OPENCODE_CONFIG_CONTENT).not.toContain("sk-runtime-only");
    expect(env.OPENCODE_CONFIG_CONTENT).toContain('"model":"openai/gpt-5.5"');
  });

  it("normalizes AetherOps provider models into opencode provider/model identifiers", () => {
    expect(modelForOpenCode("openai", "gpt-5.5")).toBe("openai/gpt-5.5");
    expect(modelForOpenCode("openai-codex", "gpt-5.5")).toBe("openai/gpt-5.5");
    expect(modelForOpenCode("anthropic", "claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4-6");
    expect(modelForOpenCode("gemini", "gemini-3.1-pro-preview")).toBe("google/gemini-3.1-pro-preview");
    expect(modelForOpenCode("openai", "openai/gpt-5.5")).toBe("openai/gpt-5.5");
  });

  it("parses opencode auth list output from the current text CLI", () => {
    const output = "\u001b[90mT\u001b[39m  Credentials ~\\.local\\share\\opencode\\auth.json\n|  OpenAI\n";

    expect(openCodeEngineTestUtils.parseAuthProvidersFromOutput(output)).toEqual(["openai"]);
    expect(openCodeEngineTestUtils.parseAuthProvidersFromOutput("Credentials\n—  0 credentials")).toEqual([]);
  });

  it("prefers the embedded opencode package before falling back to a global command", () => {
    const packageRoot = path.join(projectRoot, "node_modules", "opencode-ai");
    fs.mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, "bin", "opencode"), "#!/usr/bin/env node\n", "utf8");
    fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ version: "1.2.3" }), "utf8");

    const launcher = resolveOpenCodeLauncher(projectRoot);

    expect(launcher.source).toBe("embedded-package");
    expect(launcher.command).toBe(process.execPath);
    expect(launcher.displayName).toBe("opencode-ai");
    expect(launcher.managedPackageVersion).toBe("1.2.3");
    expect(launcher.argsPrefix[0]).toContain(path.join("node_modules", "opencode-ai", "bin", "opencode"));
  });

  it("lets OPENCODE_BIN override the embedded package launcher", () => {
    const previous = process.env.OPENCODE_BIN;
    process.env.OPENCODE_BIN = "custom-opencode";
    try {
      const launcher = resolveOpenCodeLauncher(projectRoot);

      expect(launcher.source).toBe("env");
      expect(launcher.command).toBe("custom-opencode");
      expect(launcher.argsPrefix).toEqual([]);
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCODE_BIN;
      } else {
        process.env.OPENCODE_BIN = previous;
      }
    }
  });

  it("closes stdin for spawned opencode commands so non-interactive runs do not hang", async () => {
    const stdinSensitiveScript = path.join(projectRoot, "stdin-sensitive-opencode.js");
    fs.writeFileSync(
      stdinSensitiveScript,
      [
        "process.stdin.resume();",
        "process.stdin.on('end', () => {",
        "  console.log(JSON.stringify({ type: 'assistant', text: 'stdin closed' }));",
        "  process.exit(0);",
        "});",
        "setTimeout(() => {}, 10000);",
      ].join("\n"),
      "utf8",
    );
    const runner = openCodeEngineTestUtils.createRunnerForLauncher({
      command: process.execPath,
      argsPrefix: [stdinSensitiveScript],
      displayName: "stdin-sensitive-opencode",
      source: "test-harness",
      managedPackageVersion: null,
    });

    const result = await runner.runStreaming(["run"], {
      cwd: projectRoot,
      env: buildOpenCodeEnvironment(),
      timeoutMs: 2_000,
    });

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("stdin closed");
  });

  it("reports a structured unavailable status when the CLI cannot run", async () => {
    const workspace = createWorkspaceManager(projectRoot);
    const runner: OpenCodeCommandRunner = {
      async run() {
        return {
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          cancelled: false,
          errorMessage: "spawn opencode ENOENT",
        };
      },
      async runStreaming() {
        throw new Error("not used");
      },
    };
    const engine = createOpenCodeEngine({
      projectRoot,
      workspace,
      store,
      runner,
      binary: "opencode",
    });

    const status = await engine.getStatus();

    expect(status.installed).toBe(false);
    expect(status.available).toBe(false);
    expect(status.lastFailure).toContain("ENOENT");
  });

  it("uses opencode auth list without unsupported format flags", async () => {
    const workspace = createWorkspaceManager(projectRoot);
    const observedArgs: string[][] = [];
    const runner: OpenCodeCommandRunner = {
      async run(args) {
        observedArgs.push(args);
        if (args[0] === "--version") {
          return {
            exitCode: 0,
            stdout: "opencode 1.14.28",
            stderr: "",
            timedOut: false,
            cancelled: false,
            errorMessage: null,
          };
        }
        return {
          exitCode: 0,
          stdout: args[0] === "auth" ? "Credentials\n|  OpenAI\n" : "[]",
          stderr: "",
          timedOut: false,
          cancelled: false,
          errorMessage: null,
        };
      },
      async runStreaming() {
        throw new Error("not used");
      },
    };
    const engine = createOpenCodeEngine({
      projectRoot,
      workspace,
      store,
      runner,
      binary: "opencode",
    });

    const status = await engine.getStatus();

    expect(observedArgs).toContainEqual(["auth", "list"]);
    expect(observedArgs).not.toContainEqual(["auth", "list", "--format", "json"]);
    expect(status.opencodeAuthProviders).toEqual(["openai"]);
  });

  it("redacts absolute paths from public engine session status", async () => {
    const workspace = createWorkspaceManager(projectRoot);
    const externalDirectory = path.join(os.tmpdir(), "outside-aetherops-session");
    const runner: OpenCodeCommandRunner = {
      async run(args) {
        if (args[0] === "--version") {
          return {
            exitCode: 0,
            stdout: "opencode 1.14.28",
            stderr: "",
            timedOut: false,
            cancelled: false,
            errorMessage: null,
          };
        }
        if (args[0] === "session") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              sessions: [
                {
                  id: "inside",
                  title: "Inside sandbox",
                  directory: path.join(projectRoot, "workspace", "opencode", "agents", "a", "sessions", "c"),
                  created: 1,
                  updated: 2,
                  projectId: "project-1",
                },
                {
                  id: "outside",
                  title: "Outside path",
                  directory: externalDirectory,
                },
              ],
            }),
            stderr: "",
            timedOut: false,
            cancelled: false,
            errorMessage: null,
          };
        }
        return {
          exitCode: 0,
          stdout: "[]",
          stderr: "",
          timedOut: false,
          cancelled: false,
          errorMessage: null,
        };
      },
      async runStreaming() {
        throw new Error("not used");
      },
    };
    const engine = createOpenCodeEngine({
      projectRoot,
      workspace,
      store,
      runner,
      binary: "opencode",
    });

    const status = await engine.getStatus();

    expect(status.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "inside",
          directory: "workspace/opencode/agents/a/sessions/c",
        }),
        expect.objectContaining({
          id: "outside",
          directory: "[path hidden]",
        }),
      ]),
    );
    expect(JSON.stringify(status.sessions)).not.toContain(projectRoot);
    expect(JSON.stringify(status.sessions)).not.toContain(externalDirectory);
  });

  it("returns the official opencode auth login command without copying OAuth tokens", async () => {
    const workspace = createWorkspaceManager(projectRoot);
    const runner: OpenCodeCommandRunner = {
      async run() {
        throw new Error("not used");
      },
      async runStreaming() {
        throw new Error("not used");
      },
    };
    const engine = createOpenCodeEngine({
      projectRoot,
      workspace,
      store,
      runner,
      binary: "opencode",
    });

    const result = await engine.startAuthLogin({ provider: "openai-codex", launch: false });

    expect(result.ok).toBe(true);
    expect(result.launched).toBe(false);
    expect(result.provider).toBe("openai");
    expect(result.command).toContain("auth login");
    expect(result.command).toContain("--provider openai");
  });

  it("fails prompt construction instead of silently dropping workspace guidance", () => {
    const { agent, conversation } = createConversation();
    const workspace = createWorkspaceManager(projectRoot);
    const brokenWorkspace = {
      ...workspace,
      readGuides() {
        throw new Error("guide read failed");
      },
    } as ReturnType<typeof createWorkspaceManager>;

    expect(() =>
      openCodeEngineTestUtils.buildPrompt({
        input: {
          agent,
          conversation,
          providerKind: conversation.providerKind,
          model: conversation.model,
          reasoningLevel: conversation.reasoningLevel,
          conversationId: conversation.id,
          agentId: agent.id,
          userMessage: "Probe",
          messages: store.listMessages(conversation.id),
          sendEvent() {},
        },
        workspacePath: ".",
        workspace: brokenWorkspace,
      }),
    ).toThrow("guide read failed");
  });

  it("runs opencode in the conversation sandbox and records engine metadata", async () => {
    const workspace = createWorkspaceManager(projectRoot);
    const { agent, conversation } = createConversation();
    const observed: { env: NodeJS.ProcessEnv | null } = { env: null };
    const runner: OpenCodeCommandRunner = {
      async run() {
        return {
          exitCode: 0,
          stdout: "[]",
          stderr: "",
          timedOut: false,
          cancelled: false,
          errorMessage: null,
        };
      },
      async runStreaming(_args, options) {
        observed.env = options.env;
        fs.writeFileSync(path.join(options.cwd, "note.txt"), "created by opencode", "utf8");
        options.onStdoutChunk?.('{"type":"session","sessionID":"opencode-session-1"}\n');
        options.onStdoutChunk?.('{"type":"text","part":{"text":"Done from opencode."}}\n');
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
          cancelled: false,
          errorMessage: null,
        };
      },
    };
    const engine = createOpenCodeEngine({
      projectRoot,
      workspace,
      store,
      runner,
      binary: "opencode",
    });
    store.saveProviderConfiguration({
      kind: "openai",
      status: "configured",
      secret: { apiKey: "sk-test-opencode" },
    });

    const result = await engine.runTurn({
      agent,
      conversation,
      providerKind: conversation.providerKind,
      model: conversation.model,
      reasoningLevel: conversation.reasoningLevel,
      conversationId: conversation.id,
      agentId: agent.id,
      userMessage: "Create note.txt",
      messages: store.listMessages(conversation.id),
      sendEvent() {},
    });

    expect(result.assistantText).toBe("Done from opencode.");
    expect(result.changedFiles).toEqual(["note.txt"]);
    expect(result.engineRun?.externalSessionId).toBe("opencode-session-1");
    expect(result.engineRun?.model).toBe("openai/gpt-5.5");
    expect(observed.env).not.toBeNull();
    const capturedEnv = observed.env as NodeJS.ProcessEnv;
    expect(capturedEnv["AETHEROPS_OPENAI_API_KEY"]).toBe("sk-test-opencode");
    expect(capturedEnv["OPENCODE_CONFIG_CONTENT"]).toContain("{env:AETHEROPS_OPENAI_API_KEY}");
    expect(capturedEnv["OPENCODE_CONFIG_CONTENT"]).not.toContain("sk-test-opencode");
    expect(store.getWorkspaceRun(result.runId)?.status).toBe("completed");
    expect(store.getWorkspaceRun(result.runId)?.resumeToken).toBe("opencode-session-1");
    expect(workspace.readFile({ conversationId: conversation.id, scope: "sandbox", relativePath: "note.txt" }).content).toBe(
      "created by opencode",
    );
  });

  it("adds the opencode permission bypass flag only when explicitly enabled", async () => {
    const previousAutoApprove = process.env.AETHEROPS_OPENCODE_AUTO_APPROVE;
    const workspace = createWorkspaceManager(projectRoot);
    const { agent, conversation } = createConversation();
    const observedArgs: string[][] = [];
    const runner: OpenCodeCommandRunner = {
      async run() {
        return {
          exitCode: 0,
          stdout: "[]",
          stderr: "",
          timedOut: false,
          cancelled: false,
          errorMessage: null,
        };
      },
      async runStreaming(args, options) {
        observedArgs.push(args);
        options.onStdoutChunk?.('{"type":"assistant","text":"Done."}\n');
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
          cancelled: false,
          errorMessage: null,
        };
      },
    };
    const engine = createOpenCodeEngine({
      projectRoot,
      workspace,
      store,
      runner,
      binary: "opencode",
    });

    try {
      delete process.env.AETHEROPS_OPENCODE_AUTO_APPROVE;
      await engine.runTurn({
        agent,
        conversation,
        providerKind: conversation.providerKind,
        model: conversation.model,
        reasoningLevel: conversation.reasoningLevel,
        conversationId: conversation.id,
        agentId: agent.id,
        userMessage: "No bypass",
        messages: store.listMessages(conversation.id),
        sendEvent() {},
      });
      expect(observedArgs[0]).not.toContain("--dangerously-skip-permissions");

      process.env.AETHEROPS_OPENCODE_AUTO_APPROVE = "true";
      await engine.runTurn({
        agent,
        conversation,
        providerKind: conversation.providerKind,
        model: conversation.model,
        reasoningLevel: conversation.reasoningLevel,
        conversationId: conversation.id,
        agentId: agent.id,
        userMessage: "Use bypass",
        messages: store.listMessages(conversation.id),
        sendEvent() {},
      });
      expect(observedArgs[1]).toContain("--dangerously-skip-permissions");
      const permissionEvents = store
        .listWorkspaceRuns(conversation.id)
        .flatMap((run) => store.listWorkspaceRunEvents(conversation.id, run.id))
        .filter((event) => event.payload.permissionMode === "dangerous_skip_permissions");
      expect(permissionEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: "status",
            payload: expect.objectContaining({
              permissionWarning: expect.stringContaining("Dangerous opencode permission skipping"),
            }),
          }),
        ]),
      );
    } finally {
      if (previousAutoApprove === undefined) {
        delete process.env.AETHEROPS_OPENCODE_AUTO_APPROVE;
      } else {
        process.env.AETHEROPS_OPENCODE_AUTO_APPROVE = previousAutoApprove;
      }
    }
  });

  it("fails non-JSON-only opencode output instead of fabricating assistant text", async () => {
    const workspace = createWorkspaceManager(projectRoot);
    const { agent, conversation } = createConversation();
    const runner: OpenCodeCommandRunner = {
      async run() {
        return {
          exitCode: 0,
          stdout: "[]",
          stderr: "",
          timedOut: false,
          cancelled: false,
          errorMessage: null,
        };
      },
      async runStreaming(_args, options) {
        options.onStdoutChunk?.("plain stdout that is not an assistant response\n");
        return {
          exitCode: 0,
          stdout: "plain stdout that is not an assistant response\n",
          stderr: "",
          timedOut: false,
          cancelled: false,
          errorMessage: null,
        };
      },
    };
    const engine = createOpenCodeEngine({
      projectRoot,
      workspace,
      store,
      runner,
      binary: "opencode",
    });

    await expect(
      engine.runTurn({
        agent,
        conversation,
        providerKind: conversation.providerKind,
        model: conversation.model,
        reasoningLevel: conversation.reasoningLevel,
        conversationId: conversation.id,
        agentId: agent.id,
        userMessage: "Return no JSON assistant output",
        messages: store.listMessages(conversation.id),
        sendEvent() {},
      }),
    ).rejects.toMatchObject({
      status: "failed",
      message: "opencode completed without assistant text or workspace changes.",
    });

    const run = store.listWorkspaceRuns(conversation.id)[0];
    const engineRun = await engine.getRunSummary(conversation.id, run.id);
    expect(engineRun?.eventSummary.nonJsonOutputLineCount).toBe(1);
    expect(engineRun?.eventSummary.nonJsonOutput).toContain("plain stdout");
  });

  it("fails opencode runs that emit JSON error events even when the process exits cleanly", async () => {
    const workspace = createWorkspaceManager(projectRoot);
    const { agent, conversation } = createConversation();
    const runner: OpenCodeCommandRunner = {
      async run() {
        return {
          exitCode: 0,
          stdout: "[]",
          stderr: "",
          timedOut: false,
          cancelled: false,
          errorMessage: null,
        };
      },
      async runStreaming(_args, options) {
        options.onStdoutChunk?.(
          JSON.stringify({
            type: "error",
            error: { data: { message: "Model not found: openai/missing-model." } },
          }) + "\n",
        );
        return {
          exitCode: 0,
          stdout: "",
          stderr: "ProviderModelNotFoundError",
          timedOut: false,
          cancelled: false,
          errorMessage: null,
        };
      },
    };
    const engine = createOpenCodeEngine({
      projectRoot,
      workspace,
      store,
      runner,
      binary: "opencode",
    });

    await expect(
      engine.runTurn({
        agent,
        conversation,
        providerKind: conversation.providerKind,
        model: conversation.model,
        reasoningLevel: conversation.reasoningLevel,
        conversationId: conversation.id,
        agentId: agent.id,
        userMessage: "Run",
        messages: store.listMessages(conversation.id),
        sendEvent() {},
      }),
    ).rejects.toMatchObject({
      status: "failed",
      message: "Model not found: openai/missing-model.",
    });

    const run = store.listWorkspaceRuns(conversation.id)[0];
    expect(run.status).toBe("failed");
  });

  it("fails empty opencode completions instead of reporting fake success", async () => {
    const workspace = createWorkspaceManager(projectRoot);
    const { agent, conversation } = createConversation();
    const runner: OpenCodeCommandRunner = {
      async run() {
        return {
          exitCode: 0,
          stdout: "[]",
          stderr: "",
          timedOut: false,
          cancelled: false,
          errorMessage: null,
        };
      },
      async runStreaming() {
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
          cancelled: false,
          errorMessage: null,
        };
      },
    };
    const engine = createOpenCodeEngine({
      projectRoot,
      workspace,
      store,
      runner,
      binary: "opencode",
    });

    await expect(
      engine.runTurn({
        agent,
        conversation,
        providerKind: conversation.providerKind,
        model: conversation.model,
        reasoningLevel: conversation.reasoningLevel,
        conversationId: conversation.id,
        agentId: agent.id,
        userMessage: "Run",
        messages: store.listMessages(conversation.id),
        sendEvent() {},
      }),
    ).rejects.toMatchObject({
      status: "failed",
      message: "opencode completed without assistant text or workspace changes.",
    });
  });

  it("marks failed CLI runs as failed workspace runs", async () => {
    const workspace = createWorkspaceManager(projectRoot);
    const { agent, conversation } = createConversation();
    const runner: OpenCodeCommandRunner = {
      async run() {
        return {
          exitCode: 0,
          stdout: "[]",
          stderr: "",
          timedOut: false,
          cancelled: false,
          errorMessage: null,
        };
      },
      async runStreaming() {
        return {
          exitCode: 2,
          stdout: "",
          stderr: "authentication failed",
          timedOut: false,
          cancelled: false,
          errorMessage: null,
        };
      },
    };
    const engine = createOpenCodeEngine({
      projectRoot,
      workspace,
      store,
      runner,
      binary: "opencode",
    });

    await expect(
      engine.runTurn({
        agent,
        conversation,
        providerKind: conversation.providerKind,
        model: conversation.model,
        reasoningLevel: conversation.reasoningLevel,
        conversationId: conversation.id,
        agentId: agent.id,
        userMessage: "Run",
        messages: store.listMessages(conversation.id),
        sendEvent() {},
      }),
    ).rejects.toBeInstanceOf(EngineRunError);

    const run = store.listWorkspaceRuns(conversation.id)[0];
    expect(run.status).toBe("failed");
    const events = store.listWorkspaceRunEvents(conversation.id, run.id);
    expect(events.some((event) => event.eventType === "run_failed")).toBe(true);
  });

  it("exposes timed-out opencode runs as structured engine errors", async () => {
    const workspace = createWorkspaceManager(projectRoot);
    const { agent, conversation } = createConversation();
    const runner: OpenCodeCommandRunner = {
      async run() {
        return {
          exitCode: 0,
          stdout: "[]",
          stderr: "",
          timedOut: false,
          cancelled: false,
          errorMessage: null,
        };
      },
      async runStreaming() {
        return {
          exitCode: 124,
          stdout: "",
          stderr: "",
          timedOut: true,
          cancelled: false,
          errorMessage: "process exceeded timeout",
        };
      },
    };
    const engine = createOpenCodeEngine({
      projectRoot,
      workspace,
      store,
      runner,
      binary: "opencode",
    });

    await expect(
      engine.runTurn({
        agent,
        conversation,
        providerKind: conversation.providerKind,
        model: conversation.model,
        reasoningLevel: conversation.reasoningLevel,
        conversationId: conversation.id,
        agentId: agent.id,
        userMessage: "Run",
        messages: store.listMessages(conversation.id),
        sendEvent() {},
      }),
    ).rejects.toMatchObject({
      status: "failed",
      taskStatus: "timed_out",
    });

    const run = store.listWorkspaceRuns(conversation.id)[0];
    const engineRun = await engine.getRunSummary(conversation.id, run.id);
    expect(engineRun).toEqual(
      expect.objectContaining({
        status: "timed_out",
      }),
    );
  });
});
