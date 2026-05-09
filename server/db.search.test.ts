import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "./db.js";

describe("search document index", () => {
  let dataDir: string;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherops-search-db-"));
    store = createStore(dataDir);
  });

  afterEach(() => {
    store.rawDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("rebuilds a redacted search index for research evidence and reports", () => {
    const conversation = store.saveConversation({
      title: "Search session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const project = store.createResearchProject({
      agentId: "default-agent",
      conversationId: conversation.id,
      title: "Battery research",
      objective: "Investigate SECRET_TOKEN=abc123 thermal evidence",
    });
    store.createResearchEvidence({
      projectId: project.id,
      sourceType: "human_note",
      claim: "Thermal runaway risk appears bounded",
      summary: "Authorization: Bearer secret-token-value should be redacted",
      confidence: 0.6,
    });
    const run = store.createWorkspaceRun({
      conversationId: conversation.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "Create a report",
    });
    store.createMetadataArtifact({
      agentId: "default-agent",
      conversationId: conversation.id,
      runId: run.id,
      kind: "report",
      title: "Thermal report",
      summary: "Battery thermal report with sk-testshouldhide",
      metadata: { markdown: "The report body mentions thermal constraints." },
    });

    const rebuild = store.rebuildSearchIndex();
    const evidenceSearch = store.searchDocuments({
      q: "thermal",
      agentId: "default-agent",
      conversationId: conversation.id,
      projectId: project.id,
    });
    const reportSearch = store.searchDocuments({ q: "report", agentId: "default-agent" });

    expect(rebuild.indexed).toBeGreaterThanOrEqual(4);
    expect(evidenceSearch.results.some((result) => result.kind === "evidence")).toBe(true);
    expect(reportSearch.results.some((result) => result.kind === "report")).toBe(true);
    expect(JSON.stringify([...evidenceSearch.results, ...reportSearch.results])).not.toContain("secret-token-value");
    expect(JSON.stringify([...evidenceSearch.results, ...reportSearch.results])).not.toContain("sk-testshouldhide");
  });
});
