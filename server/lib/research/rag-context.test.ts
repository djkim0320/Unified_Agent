import { describe, expect, it } from "vitest";
import { buildResearchRagContext } from "./rag-context.js";
import { extractResearchSources } from "./section-parser.js";
import type { ResearchProjectRecord } from "../../types.js";

const project: ResearchProjectRecord = {
  id: "project-1",
  agentId: "agent-1",
  conversationId: "00000000-0000-4000-8000-000000000001",
  title: "Aircraft autonomy research",
  objective: "Compare wing geometry assumptions for bounded aircraft research.",
  domain: "aircraft",
  status: "active",
  autonomyEnabled: false,
  autonomyBudget: {
    maxLoopsPerDay: 3,
    maxConsecutiveLoops: 1,
    maxRuntimeMinutes: 60,
    maxTasksPerLoop: 7,
    requireApprovalForExternal: true,
    requireApprovalForFileWrites: true,
    requireApprovalForCommandExecution: true,
    allowMcpCategories: [],
    stopWhenConfidenceAbove: 0.85,
    stopWhenNoOpenQuestions: true,
  },
  safetyPolicy: {
    allowedDomains: [],
    blockedActions: [],
    approvalRequiredActions: [],
    notes: "",
  },
  createdAt: 1,
  updatedAt: 1,
  completedAt: null,
};

describe("research RAG context", () => {
  it("retrieves relevant sources and emits source capture instructions", () => {
    const context = buildResearchRagContext({
      project,
      question: {
        id: "question-1",
        projectId: project.id,
        question: "Which wing geometry source should be trusted?",
        status: "open",
        priority: 10,
        createdAt: 1,
        updatedAt: 1,
      },
      goal: "Assess wing geometry assumptions.",
      hypotheses: [],
      evidence: [
        {
          id: "evidence-1",
          projectId: project.id,
          questionId: "question-1",
          hypothesisId: null,
          sourceType: "external",
          sourceRef: "source-1",
          claim: "Wing geometry assumptions need source reliability checks.",
          summary: "The cited report records geometry constraints.",
          confidence: 0.7,
          uncertainty: null,
          metadata: {},
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      sources: [
        {
          id: "source-1",
          projectId: project.id,
          evidenceId: "evidence-1",
          url: "https://example.test/wing",
          title: "Wing geometry report",
          author: "A. Researcher",
          institution: "Example Lab",
          publishedAt: "2024-01-01",
          accessedAt: "2026-05-11",
          summary: "A report about wing geometry assumptions.",
          quote: "The wing planform is documented.",
          snapshot: "Snapshot body.",
          reliability: 0.8,
          relatedClaim: "Geometry assumptions are documented.",
          metadata: {},
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    expect(context).toContain("Project research DB context");
    expect(context).toContain("Sources to record");
    expect(context).toContain("Wing geometry report");
    expect(context).toContain("https://example.test/wing");
  });

  it("includes linked session memory and project workspace files", () => {
    const context = buildResearchRagContext({
      project,
      goal: "Reuse previous CFD boundary notes.",
      hypotheses: [],
      evidence: [],
      sources: [],
      sessions: [
        {
          link: {
            projectId: project.id,
            conversationId: "00000000-0000-4000-8000-000000000002",
            role: "cfd-notes",
            includeInContext: true,
            createdAt: 1,
            updatedAt: 1,
          },
          conversation: {
            id: "00000000-0000-4000-8000-000000000002",
            agentId: project.agentId,
            title: "CFD boundary notes",
            channelKind: "webchat",
            sessionKind: "primary",
            parentConversationId: null,
            ownerRunId: null,
            providerKind: "openai",
            model: "gpt-5.4",
            reasoningLevel: "medium",
            createdAt: 1,
            updatedAt: 1,
          },
          summary: null,
          messages: [
            {
              role: "user",
              content: "Boundary condition note: use low-speed inlet assumptions.",
            },
          ],
        },
      ],
      projectFiles: [
        {
          path: "agents/agent-1/projects/project-1/RESEARCH_DB.md",
          content: "## Evidence\n- CFD boundary assumptions are unresolved.",
        },
      ],
    });

    expect(context).toContain("Linked project session memory");
    expect(context).toContain("CFD boundary notes");
    expect(context).toContain("Boundary condition note");
    expect(context).toContain("Project workspace files");
    expect(context).toContain("RESEARCH_DB.md");
  });

  it("includes retrieved project RAG chunks without injecting full source documents", () => {
    const context = buildResearchRagContext({
      project,
      goal: "Check heat exchanger validation",
      hypotheses: [],
      evidence: [],
      sources: [],
      ragResults: [
        {
          document: {
            id: "doc-1",
            projectId: project.id,
            sourceType: "source",
            sourceRef: "source-1",
            title: "Heat exchanger validation note",
            summary: "Relevant source summary",
            uri: "https://example.test/heat",
            reliability: 0.82,
            confidence: 0.76,
            metadata: {},
            createdAt: 1,
            updatedAt: 1,
          },
          chunk: {
            id: "chunk-1",
            documentId: "doc-1",
            projectId: project.id,
            chunkIndex: 0,
            content: "Full local content",
            redactedContent: "Boundary condition validation depends on exchanger sizing.",
            tokenHint: 12,
            metadata: {},
            createdAt: 1,
          },
          snippet: "Boundary condition validation depends on exchanger sizing.",
          score: 1.23,
          indexMode: "fts5",
        },
      ],
    });

    expect(context).toContain("Retrieved project RAG chunks");
    expect(context).toContain("Heat exchanger validation note");
    expect(context).toContain("reliability=0.82");
    expect(context).toContain("Boundary condition validation");
  });

  it("parses source records from agent output", () => {
    const parsed = extractResearchSources(`
Sources to record:
- title: Wing geometry report | url: https://example.test/wing | reliability: 0.75
  author: A. Researcher
  institution: Example Lab
  published_at: 2024-01-01
  summary: Documents wing geometry assumptions.
  quote: The planform is documented.
  related_claim: Geometry assumptions are documented.
`);

    expect(parsed).toEqual([
      expect.objectContaining({
        title: "Wing geometry report",
        url: "https://example.test/wing",
        author: "A. Researcher",
        institution: "Example Lab",
        publishedAt: "2024-01-01",
        reliability: 0.75,
        relatedClaim: "Geometry assumptions are documented.",
      }),
    ]);
  });
});
