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
        options.onStdoutChunk?.('{"type":"assistant","text":"Done from opencode."}\n');
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
});
