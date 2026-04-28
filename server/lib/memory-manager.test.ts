import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryManager } from "./memory-manager.js";
import { createWorkspaceManager } from "./workspace.js";

describe("memory manager", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("writes session summaries and outcome notes without relying on CommonJS require", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "memory-manager-"));
    tempDirs.push(projectRoot);

    const workspace = createWorkspaceManager(projectRoot);
    const memoryManager = createMemoryManager({ workspace });

    const snapshot = memoryManager.flushSessionSummary({
      agentId: "agent-1",
      conversationId: "session-1",
      conversationTitle: "Verification session",
      userMessage: "Please summarize the work.",
      assistantText: "Summary written successfully.",
    });
    const outcomePath = memoryManager.captureOutcome({
      agentId: "agent-1",
      taskTitle: "Write verification note",
      assistantText: "Created hello_browser.ts",
    });

    expect(snapshot.agentId).toBe("agent-1");
    expect(
      fs.readFileSync(
        path.join(workspace.agentsDir, "agent-1", "summaries", "session-1.md"),
        "utf8",
      ),
    ).toContain("Summary written successfully.");
    expect(outcomePath).toContain(path.join(workspace.agentsDir, "agent-1", "outcomes"));
    expect(fs.readFileSync(outcomePath, "utf8")).toContain("Created hello_browser.ts");
  });
});
