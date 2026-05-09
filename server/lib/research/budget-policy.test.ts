import { describe, expect, it } from "vitest";
import { evaluateResearchBudget } from "./budget-policy.js";
import type { ResearchLoopRecord, ResearchProjectRecord, ResearchQuestionRecord } from "../../types.js";

function project(overrides: Partial<ResearchProjectRecord> = {}): ResearchProjectRecord {
  return {
    id: "project-1",
    agentId: "agent-1",
    conversationId: null,
    title: "Research",
    objective: "Find a safe answer",
    domain: null,
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
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: null,
    ...overrides,
  };
}

function question(overrides: Partial<ResearchQuestionRecord> = {}): ResearchQuestionRecord {
  return {
    id: "question-1",
    projectId: "project-1",
    question: "What should we test?",
    status: "open",
    priority: 1,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function loop(overrides: Partial<ResearchLoopRecord> = {}): ResearchLoopRecord {
  return {
    id: "loop-1",
    projectId: "project-1",
    status: "completed",
    iteration: 0,
    goal: "Previous loop",
    selectedQuestionId: "question-1",
    proposedFlowId: null,
    taskId: null,
    runId: null,
    resultSummary: null,
    errorText: null,
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: 1000,
    ...overrides,
  };
}

describe("research budget policy", () => {
  it("blocks autoStart when project autonomy is disabled", () => {
    const result = evaluateResearchBudget({
      project: project({ autonomyEnabled: false }),
      loops: [],
      questions: [question()],
      proposedStepCount: 7,
      autoStart: true,
      approvalGatePresent: true,
      now: 2000,
    });

    expect(result.blocked).toBe(true);
    expect(result.errors.join("\n")).toContain("autoStart");
  });

  it("allows manual proposal when autonomy is disabled", () => {
    const result = evaluateResearchBudget({
      project: project({ autonomyEnabled: false }),
      loops: [],
      questions: [question()],
      proposedStepCount: 7,
      autoStart: false,
      approvalGatePresent: true,
      now: 2000,
    });

    expect(result.blocked).toBe(false);
    expect(result.warnings.join("\n")).toContain("자율 실행");
  });

  it("blocks execution when daily loop budget is exhausted", () => {
    const now = Date.now();
    const result = evaluateResearchBudget({
      project: project({
        autonomyEnabled: true,
        autonomyBudget: { ...project().autonomyBudget, maxLoopsPerDay: 1 },
      }),
      loops: [loop({ createdAt: now - 1000 })],
      questions: [question()],
      proposedStepCount: 7,
      manualStart: true,
      approvalGatePresent: true,
      now,
    });

    expect(result.blocked).toBe(true);
    expect(result.errors.join("\n")).toContain("예산");
  });

  it("requires an approval gate when policy requires approval", () => {
    const result = evaluateResearchBudget({
      project: project({ autonomyEnabled: true }),
      loops: [],
      questions: [question()],
      proposedStepCount: 6,
      autoStart: true,
      approvalGatePresent: false,
      now: 2000,
    });

    expect(result.blocked).toBe(true);
    expect(result.errors.join("\n")).toContain("승인 게이트");
  });
});
