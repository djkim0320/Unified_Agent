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

  it("builds a project RAG document index from sources, evidence, summaries, and reports", () => {
    const conversation = store.saveConversation({
      title: "Aero research session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const project = store.createResearchProject({
      agentId: "default-agent",
      conversationId: conversation.id,
      title: "Aero thermal project",
      objective: "Compare aircraft cooling approaches",
    });
    store.saveSessionSummary({
      conversationId: conversation.id,
      summary: "Current goal is to compare thermal management options.",
      decisions: ["Use conservative evidence scoring"],
      openQuestions: ["Which source is most reliable?"],
      nextActions: ["Review heat exchanger notes"],
    });
    store.createResearchEvidence({
      projectId: project.id,
      sourceType: "human_note",
      claim: "Heat exchanger sizing is the dominant uncertainty",
      summary: "The fake secret Authorization: Bearer hidden-value must not appear in snippets.",
      confidence: 0.7,
    });
    store.createResearchSource({
      projectId: project.id,
      title: "Heat exchanger design note",
      url: "https://example.com/heat-exchanger",
      summary: "A source about aircraft heat exchanger sizing and validation.",
      quote: "Sizing is sensitive to boundary conditions.",
      reliability: 0.8,
    });
    const run = store.createWorkspaceRun({
      conversationId: conversation.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "Create research report",
    });
    store.createMetadataArtifact({
      agentId: "default-agent",
      conversationId: conversation.id,
      runId: run.id,
      kind: "report",
      title: "Cooling report",
      summary: "Report covering exchanger evidence",
      metadata: { markdown: "Findings mention heat exchanger validation and SECRET_TOKEN=hide-me." },
    });

    const rebuilt = store.rebuildProjectRagIndex(project.id);
    const sourceSearch = store.searchProjectRag({ projectId: project.id, q: "heat exchanger validation", limit: 10 });
    const evidenceSearch = store.searchProjectRag({ projectId: project.id, q: "dominant uncertainty", limit: 10 });
    const reportSearch = store.searchProjectRag({ projectId: project.id, q: "exchanger evidence", limit: 10 });
    const serialized = JSON.stringify([...sourceSearch.results, ...evidenceSearch.results, ...reportSearch.results]);

    expect(rebuilt.documentCount).toBeGreaterThanOrEqual(4);
    expect(rebuilt.chunkCount).toBeGreaterThanOrEqual(4);
    expect(sourceSearch.results.some((result) => result.document.sourceType === "source")).toBe(true);
    expect(evidenceSearch.results.some((result) => result.document.sourceType === "evidence")).toBe(true);
    expect(reportSearch.results.some((result) => result.document.sourceType === "report")).toBe(true);
    expect(serialized).not.toContain("hidden-value");
    expect(serialized).not.toContain("hide-me");
  });
});
