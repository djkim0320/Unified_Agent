import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceManager } from "./workspace.js";

function createTempProjectRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "workspace-hardening-"));
}

function createTestWorkspace(projectRoot = createTempProjectRoot()) {
  const conversations = new Set<string>();
  const workspace = createWorkspaceManager(projectRoot, {
    conversationExists: (conversationId) => conversations.has(conversationId),
  });

  return {
    projectRoot,
    workspace,
    addConversation(conversationId: string) {
      conversations.add(conversationId);
      workspace.createConversationWorkspace(conversationId);
      return path.join(workspace.conversationsDir, conversationId);
    },
  };
}

afterEach(() => {
  // Clean up any temporary workspace roots created by tests.
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith("workspace-hardening-")) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
});

describe("workspace sandbox hardening", () => {
  it("bootstraps soul and heartbeat files for each agent workspace", () => {
    const { workspace } = createTestWorkspace();
    const agentId = "agent-heartbeat";
    workspace.createAgentWorkspace(agentId);

    const soul = workspace.readAgentSoul(agentId);
    expect(soul.path).toBe("SOUL.md");
    expect(soul.content).toContain("# SOUL");

    const heartbeat = workspace.readAgentHeartbeat(agentId);
    expect(heartbeat.path).toBe("HEARTBEAT.md");
    expect(heartbeat.enabled).toBe(false);
    expect(heartbeat.intervalMinutes).toBe(60);
    expect(heartbeat.lastRun).toBeNull();
    expect(heartbeat.instructions).toContain("Describe what the agent should inspect");
  });

  it("round-trips heartbeat frontmatter and soul content", () => {
    const { workspace } = createTestWorkspace();
    const agentId = "agent-heartbeat-write";
    workspace.createAgentWorkspace(agentId);

    const soul = workspace.writeAgentSoul(agentId, "# SOUL\n\nCustom identity.");
    expect(soul.content).toBe("# SOUL\n\nCustom identity.");

    const heartbeat = workspace.writeAgentHeartbeat(agentId, {
      enabled: true,
      intervalMinutes: 15,
      lastRun: "2026-04-13T00:00:00.000Z",
      instructions: "Check inbox and summarize updates.",
    });

    expect(heartbeat.enabled).toBe(true);
    expect(heartbeat.intervalMinutes).toBe(15);
    expect(heartbeat.lastRun).toBe("2026-04-13T00:00:00.000Z");
    expect(heartbeat.instructions).toBe("Check inbox and summarize updates.");
    expect(heartbeat.parseError).toBeNull();
    expect(fs.readFileSync(path.join(workspace.agentsDir, agentId, "HEARTBEAT.md"), "utf8")).toContain(
      "enabled: true",
    );
  });

  it("rejects path traversal via .. segments", () => {
    const { workspace, addConversation } = createTestWorkspace();
    const conversationId = "conv-traversal";
    addConversation(conversationId);

    expect(() =>
      workspace.readFile({
        conversationId,
        scope: "sandbox",
        relativePath: "../outside.txt",
      }),
    ).toThrow(/path traversal/i);
  });

  it("rejects reading through an unsafe junction or symlink", () => {
    const { workspace, addConversation, projectRoot } = createTestWorkspace();
    const conversationId = "conv-links";
    const sandboxDir = addConversation(conversationId);
    const outsideDir = path.join(projectRoot, "outside");
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "top secret", "utf8");
    fs.symlinkSync(outsideDir, path.join(sandboxDir, "escape"), "junction");

    expect(() =>
      workspace.readFile({
        conversationId,
        scope: "sandbox",
        relativePath: "escape/secret.txt",
      }),
    ).toThrow(/unsafe link/i);

    expect(() =>
      workspace.writeFile({
        conversationId,
        scope: "sandbox",
        relativePath: "escape/new.txt",
        content: "blocked",
      }),
    ).toThrow(/unsafe link/i);
  });

  it("rejects mutating operations through unsafe link components", () => {
    const { workspace, addConversation, projectRoot } = createTestWorkspace();
    const conversationId = "conv-link-mutations";
    const sandboxDir = addConversation(conversationId);
    const outsideDir = path.join(projectRoot, "outside-mutations");
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "do not touch", "utf8");
    fs.symlinkSync(outsideDir, path.join(sandboxDir, "escape"), "junction");
    workspace.writeFile({
      conversationId,
      scope: "sandbox",
      relativePath: "notes.txt",
      content: "hello",
    });

    expect(() =>
      workspace.makeDir({
        conversationId,
        scope: "sandbox",
        relativePath: "escape/new-dir",
      }),
    ).toThrow(/unsafe link/i);

    expect(() =>
      workspace.deletePath({
        conversationId,
        scope: "sandbox",
        relativePath: "escape/secret.txt",
      }),
    ).toThrow(/unsafe link/i);

    expect(() =>
      workspace.movePath({
        conversationId,
        scope: "sandbox",
        from: "escape",
        to: "moved-link",
      }),
    ).toThrow(/unsafe link/i);

    expect(() =>
      workspace.movePath({
        conversationId,
        scope: "sandbox",
        from: "notes.txt",
        to: "escape/notes.txt",
      }),
    ).toThrow(/unsafe link/i);

    expect(fs.readFileSync(path.join(outsideDir, "secret.txt"), "utf8")).toBe("do not touch");
    expect(fs.existsSync(path.join(outsideDir, "notes.txt"))).toBe(false);
  });

  it("rejects move targets that try to escape the sandbox", () => {
    const { workspace, addConversation } = createTestWorkspace();
    const conversationId = "conv-move";
    addConversation(conversationId);
    workspace.writeFile({
      conversationId,
      scope: "sandbox",
      relativePath: "notes.txt",
      content: "hello",
    });

    expect(() =>
      workspace.movePath({
        conversationId,
        scope: "sandbox",
        from: "notes.txt",
        to: "../escaped.txt",
      }),
    ).toThrow(/path traversal/i);
  });

  it("does not create sandbox directories for nonexistent conversations on read-only access", () => {
    const projectRoot = createTempProjectRoot();
    const workspace = createWorkspaceManager(projectRoot, {
      conversationExists: () => false,
    });
    const sandboxDir = path.join(workspace.conversationsDir, "missing-conversation");

    expect(() =>
      workspace.listTree({
        conversationId: "missing-conversation",
        scope: "sandbox",
      }),
    ).toThrow(/conversation not found/i);
    expect(fs.existsSync(sandboxDir)).toBe(false);
  });

  it("keeps root scope disabled by default", () => {
    const { workspace, addConversation } = createTestWorkspace();
    const conversationId = "conv-root-disabled";
    addConversation(conversationId);

    expect(() =>
      workspace.listTree({
        conversationId,
        scope: "root",
      }),
    ).toThrow(/root workspace scope is disabled/i);
  });

  it("cleans up only the deleted conversation sandbox", () => {
    const { workspace, addConversation } = createTestWorkspace();
    const firstConversationId = "conv-delete-1";
    const secondConversationId = "conv-delete-2";
    const firstSandbox = addConversation(firstConversationId);
    const secondSandbox = addConversation(secondConversationId);

    workspace.writeFile({
      conversationId: firstConversationId,
      scope: "sandbox",
      relativePath: "notes.txt",
      content: "remove me",
    });
    workspace.writeFile({
      conversationId: secondConversationId,
      scope: "sandbox",
      relativePath: "keep.txt",
      content: "keep me",
    });
    workspace.writeFile({
      conversationId: firstConversationId,
      scope: "shared",
      relativePath: "shared.txt",
      content: "shared",
    });

    expect(workspace.deleteConversationWorkspace(firstConversationId)).toBe(true);
    expect(fs.existsSync(firstSandbox)).toBe(false);
    expect(fs.existsSync(secondSandbox)).toBe(true);
    expect(fs.existsSync(path.join(workspace.sharedDir, "shared.txt"))).toBe(true);
  });

  it("round-trips Korean filenames and Unicode content", () => {
    const { workspace, addConversation } = createTestWorkspace();
    const conversationId = "conv-unicode";
    addConversation(conversationId);
    const relativePath = "메모.txt";
    const content = "안녕하세요, 워크스페이스";

    workspace.writeFile({
      conversationId,
      scope: "sandbox",
      relativePath,
      content,
    });

    const file = workspace.readFile({
      conversationId,
      scope: "sandbox",
      relativePath,
    });

    expect(file.path).toBe(relativePath);
    expect(file.content).toBe(content);
    expect(file.binary).toBe(false);
    expect(file.unsupportedEncoding).toBe(false);
  });

  it("reads UTF-16 BOM text safely and flags unsupported encodings", () => {
    const { workspace, addConversation } = createTestWorkspace();
    const conversationId = "conv-encoding";
    const sandboxDir = addConversation(conversationId);

    const utf16Path = path.join(sandboxDir, "utf16.txt");
    fs.writeFileSync(
      utf16Path,
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("안녕", "utf16le")]),
    );
    const utf16File = workspace.readFile({
      conversationId,
      scope: "sandbox",
      relativePath: "utf16.txt",
    });
    expect(utf16File.content).toBe("안녕");
    expect(utf16File.encoding).toBe("utf-16le");

    const invalidPath = path.join(sandboxDir, "invalid.txt");
    fs.writeFileSync(invalidPath, Buffer.from([0xc3, 0x28]));
    const invalidFile = workspace.readFile({
      conversationId,
      scope: "sandbox",
      relativePath: "invalid.txt",
    });
    expect(invalidFile.binary).toBe(true);
    expect(invalidFile.unsupportedEncoding).toBe(true);
    expect(invalidFile.content).toBe("");
  });
});
