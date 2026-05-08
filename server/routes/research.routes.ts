import type express from "express";
import { z } from "zod";
import { DEFAULT_RESEARCH_AUTONOMY_BUDGET, DEFAULT_RESEARCH_SAFETY_POLICY } from "../db.js";
import { withEngineAuthEvidence } from "../lib/engine-auth-evidence.js";
import { redactSensitiveText } from "../lib/redaction.js";
import { normalizeReasoningLevel } from "../reasoning-options.js";
import { ProviderKindSchema, ReasoningLevelSchema } from "../schemas/common.js";
import type {
  ResearchAutonomyBudget,
  ResearchLoopRecord,
  ResearchProjectRecord,
  ResearchSafetyPolicy,
} from "../types.js";
import {
  requireAgent,
  type AppGateway,
  type AppStore,
} from "./context.js";
import { buildTaskFlowResponse } from "../lib/task-flow-response.js";

type ResearchFlowStepDraft = {
  stepKey: string;
  title: string;
  prompt: string;
  dependencyStepKey: string | null;
  stepKind: "task" | "approval_gate" | "verification_gate";
};

const ResearchProjectCreateSchema = z.object({
  agentId: z.string().min(1).max(120),
  conversationId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(160),
  objective: z.string().min(1).max(20_000),
  domain: z.string().max(120).optional().nullable(),
  autonomyEnabled: z.boolean().optional().default(false),
  autonomyBudget: z.record(z.unknown()).optional().default({}),
  safetyPolicy: z.record(z.unknown()).optional().default({}),
});

const ResearchProjectPatchSchema = ResearchProjectCreateSchema.omit({ agentId: true })
  .partial()
  .extend({
    status: z.enum(["active", "paused", "completed", "archived"]).optional(),
  });

const ResearchQuestionCreateSchema = z.object({
  question: z.string().min(1).max(5000),
  status: z.enum(["open", "investigating", "answered", "blocked"]).optional().default("open"),
  priority: z.number().int().min(0).max(100).optional().default(0),
});

const ResearchQuestionPatchSchema = ResearchQuestionCreateSchema.partial();

const ResearchHypothesisCreateSchema = z.object({
  questionId: z.string().uuid().optional().nullable(),
  hypothesis: z.string().min(1).max(5000),
  status: z.enum(["proposed", "supported", "contradicted", "unresolved"]).optional().default("proposed"),
  confidence: z.number().min(0).max(1).optional().default(0),
});

const ResearchHypothesisPatchSchema = ResearchHypothesisCreateSchema.partial();

const ResearchEvidenceCreateSchema = z.object({
  questionId: z.string().uuid().optional().nullable(),
  hypothesisId: z.string().uuid().optional().nullable(),
  sourceType: z
    .enum(["artifact", "report", "run", "task", "message", "human_note", "external"])
    .optional()
    .default("human_note"),
  sourceRef: z.string().max(240).optional().nullable(),
  claim: z.string().min(1).max(5000),
  summary: z.string().min(1).max(20_000),
  confidence: z.number().min(0).max(1).optional().default(0.5),
  uncertainty: z.string().max(5000).optional().nullable(),
  metadata: z.record(z.unknown()).optional().default({}),
});

const ResearchLoopProposeSchema = z.object({
  questionId: z.string().uuid().optional().nullable(),
  goal: z.string().max(20_000).optional().nullable(),
  autoStart: z.boolean().optional().default(false),
});

const ResearchReportTaskSchema = z.object({
  autoStart: z.boolean().optional().default(true),
  providerKind: ProviderKindSchema.optional(),
  model: z.string().min(1).max(120).optional(),
  reasoningLevel: ReasoningLevelSchema.optional(),
});

const ResearchSubagentSchema = z.object({
  role: z.enum(["researcher", "critic", "verifier", "synthesizer", "experiment-planner"]),
  questionId: z.string().uuid().optional().nullable(),
  prompt: z.string().max(20_000).optional().nullable(),
  autoStart: z.boolean().optional().default(true),
});

const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  agentId: z.string().min(1).max(120).optional(),
  conversationId: z.string().uuid().optional(),
});

function mergeBudget(value: Record<string, unknown> | undefined): ResearchAutonomyBudget {
  return {
    ...DEFAULT_RESEARCH_AUTONOMY_BUDGET,
    ...(value ?? {}),
    allowMcpCategories: Array.isArray(value?.allowMcpCategories)
      ? value.allowMcpCategories.filter((item): item is string => typeof item === "string")
      : DEFAULT_RESEARCH_AUTONOMY_BUDGET.allowMcpCategories,
  } as ResearchAutonomyBudget;
}

function mergePolicy(value: Record<string, unknown> | undefined): ResearchSafetyPolicy {
  return {
    ...DEFAULT_RESEARCH_SAFETY_POLICY,
    ...(value ?? {}),
    allowedDomains: Array.isArray(value?.allowedDomains)
      ? value.allowedDomains.filter((item): item is string => typeof item === "string")
      : DEFAULT_RESEARCH_SAFETY_POLICY.allowedDomains,
    blockedActions: Array.isArray(value?.blockedActions)
      ? value.blockedActions.filter((item): item is string => typeof item === "string")
      : DEFAULT_RESEARCH_SAFETY_POLICY.blockedActions,
    approvalRequiredActions: Array.isArray(value?.approvalRequiredActions)
      ? value.approvalRequiredActions.filter((item): item is string => typeof item === "string")
      : DEFAULT_RESEARCH_SAFETY_POLICY.approvalRequiredActions,
  } as ResearchSafetyPolicy;
}

function requireResearchProject(store: AppStore, response: express.Response, projectId: string) {
  const project = store.getResearchProject(projectId);
  if (!project) {
    response.status(404).json({ error: "Research project not found." });
    return null;
  }
  return project;
}

function resolveProjectConversation(store: AppStore, project: ResearchProjectRecord) {
  const existing = project.conversationId ? store.getConversation(project.conversationId) : null;
  if (existing) {
    return existing;
  }
  const agent = store.getAgent(project.agentId);
  if (!agent) {
    throw new Error("Agent not found.");
  }
  return (
    store.listConversations(agent.id)[0] ??
    store.saveConversation({
      agentId: agent.id,
      title: project.title,
      providerKind: agent.providerKind,
      model: agent.model,
      reasoningLevel: agent.reasoningLevel,
    })
  );
}

function linearlyDependentSteps(project: ResearchProjectRecord, question: string, goal: string): ResearchFlowStepDraft[] {
  const base = [
    {
      stepKey: "research-plan",
      title: "연구 계획 수립",
      prompt: [
        `Research objective: ${project.objective}`,
        `Focused question: ${question}`,
        `Loop goal: ${goal}`,
        "Produce a bounded research plan. Do not execute external or irreversible actions.",
      ].join("\n"),
      stepKind: "task" as const,
    },
    {
      stepKey: "evidence-gathering",
      title: "증거 수집",
      prompt: "Inspect existing local reports, artifacts, summaries, and opencode-accessible project files. Gather evidence without fabricating citations.",
      stepKind: "task" as const,
    },
    {
      stepKey: "hypothesis-update",
      title: "가설 갱신",
      prompt: "Update hypotheses based on gathered evidence. Use sections: Claims, Evidence, Uncertainty, Next questions.",
      stepKind: "task" as const,
    },
    {
      stepKey: "operator-approval",
      title: "운영자 승인",
      prompt: "Human checkpoint before synthesis or any external/high-risk work.",
      stepKind: "approval_gate" as const,
    },
    {
      stepKey: "synthesis",
      title: "종합",
      prompt: "Synthesize findings into a concise research result. Keep uncertainty explicit.",
      stepKind: "task" as const,
    },
    {
      stepKey: "verification",
      title: "검증",
      prompt: "Verify claims against local evidence. List assumptions, gaps, and reproducibility notes.",
      stepKind: "verification_gate" as const,
    },
    {
      stepKey: "next-actions",
      title: "다음 실험 제안",
      prompt: "Recommend the next bounded research loop or stop condition. Do not invent external source claims.",
      stepKind: "task" as const,
    },
  ];
  return base.map((step, index) => ({
    ...step,
    dependencyStepKey: index === 0 ? null : base[index - 1].stepKey,
  }));
}

function buildResearchReportMarkdown(input: {
  project: ResearchProjectRecord;
  questions: ReturnType<AppStore["listResearchQuestions"]>;
  hypotheses: ReturnType<AppStore["listResearchHypotheses"]>;
  evidence: ReturnType<AppStore["listResearchEvidence"]>;
  loops: ResearchLoopRecord[];
}) {
  const { project, questions, hypotheses, evidence, loops } = input;
  const evidenceLines = evidence.map(
    (item) =>
      `| ${item.claim.replace(/\|/g, "/")} | ${item.sourceType}:${item.sourceRef ?? "-"} | ${item.confidence.toFixed(2)} | ${
        item.uncertainty ? item.uncertainty.replace(/\|/g, "/") : "-"
      } |`,
  );
  return [
    `# Research Report: ${project.title}`,
    "",
    "## Objective",
    project.objective,
    "",
    "## Method",
    "AetherOps collected local session, flow, task, run, report, and artifact records. Execution, when used, was routed through opencode-backed tasks/flows only.",
    "",
    "## Findings",
    evidence.length
      ? evidence.map((item) => `- ${item.claim} (confidence ${item.confidence.toFixed(2)})`).join("\n")
      : "- No evidence has been recorded yet.",
    "",
    "## Evidence table",
    "| Claim | Source | Confidence | Uncertainty |",
    "| --- | --- | --- | --- |",
    ...(evidenceLines.length ? evidenceLines : ["| No evidence | - | - | - |"]),
    "",
    "## Hypotheses and confidence",
    hypotheses.length
      ? hypotheses.map((item) => `- ${item.hypothesis}: ${item.status}, confidence ${item.confidence.toFixed(2)}`).join("\n")
      : "- No hypotheses recorded.",
    "",
    "## Uncertainties",
    evidence.some((item) => item.uncertainty)
      ? evidence.filter((item) => item.uncertainty).map((item) => `- ${item.uncertainty}`).join("\n")
      : "- No explicit uncertainty recorded yet.",
    "",
    "## Reproducibility notes",
    `- Questions tracked: ${questions.length}`,
    `- Loops tracked: ${loops.length}`,
    "- No provider secrets or workspace files are embedded in this report.",
    "",
    "## Next experiments",
    questions
      .filter((item) => item.status === "open" || item.status === "investigating")
      .slice(0, 5)
      .map((item) => `- ${item.question}`)
      .join("\n") || "- No open questions remain.",
    "",
    "## Appendix: linked records",
    loops.map((loop) => `- Loop ${loop.id}: ${loop.status}, flow=${loop.proposedFlowId ?? "-"}`).join("\n") ||
      "- No loops linked.",
  ].join("\n");
}

function snippet(value: string, query: string) {
  const text = redactSensitiveText(value);
  const lower = text.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index < 0) {
    return text.slice(0, 240);
  }
  const start = Math.max(0, index - 80);
  return `${start > 0 ? "..." : ""}${text.slice(start, index + query.length + 160)}${
    index + query.length + 160 < text.length ? "..." : ""
  }`;
}

export function registerResearchRoutes(
  app: express.Express,
  params: {
    store: AppStore;
    gateway: AppGateway;
  },
) {
  const { store, gateway } = params;

  app.get("/api/research/projects", (request, response) => {
    const agentId = typeof request.query.agentId === "string" ? request.query.agentId : undefined;
    response.json({ projects: store.listResearchProjects(agentId) });
  });

  app.post("/api/research/projects", (request, response) => {
    const body = ResearchProjectCreateSchema.parse(request.body);
    const agent = requireAgent(store, response, body.agentId);
    if (!agent) {
      return;
    }
    response.json({
      project: store.createResearchProject({
        agentId: agent.id,
        conversationId: body.conversationId ?? null,
        title: body.title,
        objective: body.objective,
        domain: body.domain ?? null,
        autonomyEnabled: body.autonomyEnabled,
        autonomyBudget: mergeBudget(body.autonomyBudget),
        safetyPolicy: mergePolicy(body.safetyPolicy),
      }),
    });
  });

  app.get("/api/research/projects/:projectId", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    response.json({
      project,
      questions: store.listResearchQuestions(project.id),
      hypotheses: store.listResearchHypotheses(project.id),
      evidence: store.listResearchEvidence(project.id),
      loops: store.listResearchLoops(project.id),
    });
  });

  app.patch("/api/research/projects/:projectId", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    const body = ResearchProjectPatchSchema.parse(request.body);
    const updated = store.updateResearchProject({
      projectId: project.id,
      title: body.title,
      objective: body.objective,
      domain: body.domain,
      status: body.status,
      autonomyEnabled: body.autonomyEnabled,
      autonomyBudget: body.autonomyBudget ? mergeBudget(body.autonomyBudget) : undefined,
      safetyPolicy: body.safetyPolicy ? mergePolicy(body.safetyPolicy) : undefined,
    });
    response.json({ project: updated });
  });

  app.get("/api/research/projects/:projectId/questions", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    response.json({ questions: store.listResearchQuestions(project.id) });
  });

  app.post("/api/research/projects/:projectId/questions", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    const body = ResearchQuestionCreateSchema.parse(request.body);
    response.json({
      question: store.createResearchQuestion({
        projectId: project.id,
        question: body.question,
        status: body.status,
        priority: body.priority,
      }),
    });
  });

  app.patch("/api/research/questions/:questionId", (request, response) => {
    const existing = store.getResearchQuestion(request.params.questionId);
    if (!existing) {
      response.status(404).json({ error: "Research question not found." });
      return;
    }
    const body = ResearchQuestionPatchSchema.parse(request.body);
    response.json({
      question: store.updateResearchQuestion({
        questionId: existing.id,
        question: body.question,
        status: body.status,
        priority: body.priority,
      }),
    });
  });

  app.get("/api/research/projects/:projectId/hypotheses", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    response.json({ hypotheses: store.listResearchHypotheses(project.id) });
  });

  app.post("/api/research/projects/:projectId/hypotheses", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    const body = ResearchHypothesisCreateSchema.parse(request.body);
    response.json({
      hypothesis: store.createResearchHypothesis({
        projectId: project.id,
        questionId: body.questionId ?? null,
        hypothesis: body.hypothesis,
        status: body.status,
        confidence: body.confidence,
      }),
    });
  });

  app.patch("/api/research/hypotheses/:hypothesisId", (request, response) => {
    const existing = store.getResearchHypothesis(request.params.hypothesisId);
    if (!existing) {
      response.status(404).json({ error: "Research hypothesis not found." });
      return;
    }
    const body = ResearchHypothesisPatchSchema.parse(request.body);
    response.json({
      hypothesis: store.updateResearchHypothesis({
        hypothesisId: existing.id,
        questionId: body.questionId,
        hypothesis: body.hypothesis,
        status: body.status,
        confidence: body.confidence,
      }),
    });
  });

  app.get("/api/research/projects/:projectId/evidence", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    response.json({ evidence: store.listResearchEvidence(project.id) });
  });

  app.post("/api/research/projects/:projectId/evidence", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    const body = ResearchEvidenceCreateSchema.parse(request.body);
    response.json({
      evidence: store.createResearchEvidence({
        projectId: project.id,
        questionId: body.questionId ?? null,
        hypothesisId: body.hypothesisId ?? null,
        sourceType: body.sourceType,
        sourceRef: body.sourceRef ?? null,
        claim: redactSensitiveText(body.claim),
        summary: redactSensitiveText(body.summary),
        confidence: body.confidence,
        uncertainty: body.uncertainty ? redactSensitiveText(body.uncertainty) : null,
        metadata: body.metadata,
      }),
    });
  });

  app.get("/api/research/projects/:projectId/loops", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    response.json({ loops: store.listResearchLoops(project.id) });
  });

  app.post("/api/research/projects/:projectId/loops/propose", async (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    const body = ResearchLoopProposeSchema.parse(request.body ?? {});
    if (body.autoStart && !project.autonomyEnabled) {
      response.status(409).json({ error: "Research autonomy is disabled for this project." });
      return;
    }
    const questions = store.listResearchQuestions(project.id);
    const question =
      (body.questionId ? questions.find((item) => item.id === body.questionId) : null) ??
      questions.find((item) => item.status === "open" || item.status === "investigating") ??
      null;
    if (!question) {
      response.status(409).json({ error: "At least one open research question is required." });
      return;
    }
    const conversation = resolveProjectConversation(store, project);
    const narrowedGoal = body.goal?.trim() || question.question;
    const loop = store.createResearchLoop({
      projectId: project.id,
      goal: narrowedGoal,
      selectedQuestionId: question.id,
    });
    const flowResult = await gateway.createFlow({
      agentId: project.agentId,
      conversationId: conversation.id,
      title: `${project.title}: ${question.question.slice(0, 80)}`,
      autoStart: false,
      steps: linearlyDependentSteps(project, question.question, narrowedGoal),
    });
    const updatedLoop = store.transitionResearchLoop({
      loopId: loop.id,
      proposedFlowId: flowResult.flow.id,
      status: body.autoStart ? "running" : "queued",
    })!;
    if (body.autoStart) {
      await gateway.taskManager.startTaskFlow(flowResult.flow.id);
    }
    const flow = store.getTaskFlow(flowResult.flow.id) ?? flowResult.flow;
    response.json({
      loop: store.getResearchLoop(updatedLoop.id),
      flow: buildTaskFlowResponse(store, flow).flow,
      steps: buildTaskFlowResponse(store, flow).steps,
    });
  });

  app.post("/api/research/loops/:loopId/start", async (request, response) => {
    const loop = store.getResearchLoop(request.params.loopId);
    if (!loop) {
      response.status(404).json({ error: "Research loop not found." });
      return;
    }
    if (!loop.proposedFlowId) {
      response.status(409).json({ error: "Research loop has no linked flow to start." });
      return;
    }
    await gateway.taskManager.startTaskFlow(loop.proposedFlowId);
    response.json({
      loop: store.transitionResearchLoop({ loopId: loop.id, status: "running", clearErrorText: true }),
      flow: store.getTaskFlow(loop.proposedFlowId),
    });
  });

  app.post("/api/research/loops/:loopId/cancel", async (request, response) => {
    const loop = store.getResearchLoop(request.params.loopId);
    if (!loop) {
      response.status(404).json({ error: "Research loop not found." });
      return;
    }
    if (loop.proposedFlowId) {
      await gateway.taskManager.cancelTaskFlow(loop.proposedFlowId).catch(() => null);
    }
    response.json({
      loop: store.transitionResearchLoop({
        loopId: loop.id,
        status: "cancelled",
        completedAt: Date.now(),
        errorText: "Research loop was cancelled by the operator.",
      }),
    });
  });

  app.get("/api/research/projects/:projectId/preflight", async (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    const agent = store.getAgent(project.agentId);
    const questions = store.listResearchQuestions(project.id);
    const loops = store.listResearchLoops(project.id);
    const checks: Array<{ id: string; label: string; status: "ok" | "warn" | "error"; message: string }> = [];
    checks.push(project.status === "active" ? { id: "project", label: "Project", status: "ok", message: "연구 프로젝트가 활성 상태입니다." } : { id: "project", label: "Project", status: "error", message: "활성 상태의 연구 프로젝트만 Loop를 시작할 수 있습니다." });
    checks.push(agent ? { id: "agent", label: "Agent", status: "ok", message: `${agent.name} 에이전트가 연결되어 있습니다.` } : { id: "agent", label: "Agent", status: "error", message: "연결된 에이전트를 찾을 수 없습니다." });
    checks.push(questions.some((item) => item.status === "open" || item.status === "investigating") ? { id: "questions", label: "Questions", status: "ok", message: "열린 연구 질문이 있습니다." } : { id: "questions", label: "Questions", status: "warn", message: "열린 연구 질문이 없습니다." });
    const today = Date.now() - 24 * 60 * 60 * 1000;
    const loopsToday = loops.filter((loop) => loop.createdAt >= today).length;
    checks.push(
      loopsToday < project.autonomyBudget.maxLoopsPerDay
        ? { id: "budget", label: "Budget", status: "ok", message: `오늘 Loop ${loopsToday}/${project.autonomyBudget.maxLoopsPerDay}개 사용.` }
        : { id: "budget", label: "Budget", status: "error", message: "일일 Loop 예산을 초과했습니다." },
    );
    if (agent) {
      const engine = withEngineAuthEvidence(await gateway.agentEngine.getStatus(), store, {
        providerKind: agent.providerKind,
        model: agent.model,
      });
      checks.push(
        engine.available && engine.authEvidence?.status === "usable"
          ? { id: "opencode", label: "opencode", status: "ok", message: engine.authEvidence.message }
          : {
              id: "opencode",
              label: "opencode",
              status: engine.available ? "warn" : "error",
              message: engine.authEvidence?.message ?? engine.lastFailure ?? "opencode 준비 상태를 확인해야 합니다.",
            },
      );
      checks.push(
        engine.environment.autoApprovePermissions
          ? { id: "permissions", label: "Permissions", status: "warn", message: "위험 권한 자동 승인 플래그가 켜져 있습니다." }
          : { id: "permissions", label: "Permissions", status: "ok", message: "위험 권한 자동 승인 플래그가 꺼져 있습니다." },
      );
    }
    checks.push(
      project.autonomyEnabled
        ? { id: "autonomy", label: "Autonomy", status: "ok", message: "자율 Loop 실행이 켜져 있습니다. 그래도 승인 게이트는 유지됩니다." }
        : { id: "autonomy", label: "Autonomy", status: "warn", message: "자율 실행은 꺼져 있습니다. 제안과 수동 시작은 가능합니다." },
    );
    response.json({
      ok: !checks.some((check) => check.status === "error"),
      checks,
      budget: project.autonomyBudget,
      safetyPolicy: project.safetyPolicy,
    });
  });

  app.post("/api/research/projects/:projectId/report", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    const conversation = resolveProjectConversation(store, project);
    const questions = store.listResearchQuestions(project.id);
    const hypotheses = store.listResearchHypotheses(project.id);
    const evidence = store.listResearchEvidence(project.id);
    const loops = store.listResearchLoops(project.id);
    const markdown = buildResearchReportMarkdown({ project, questions, hypotheses, evidence, loops });
    const artifact = store.createMetadataArtifact({
      agentId: project.agentId,
      conversationId: conversation.id,
      kind: "report",
      title: `Research report: ${project.title}`,
      summary: redactSensitiveText(markdown.slice(0, 800)),
      metadata: {
        markdown: redactSensitiveText(markdown),
        researchProjectId: project.id,
        evidenceCount: evidence.length,
        hypothesisCount: hypotheses.length,
        loopCount: loops.length,
      },
    });
    response.json({ artifact, markdown: redactSensitiveText(markdown), redacted: true });
  });

  app.post("/api/research/projects/:projectId/report-task", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    const agent = store.getAgent(project.agentId);
    if (!agent) {
      response.status(404).json({ error: "Agent not found." });
      return;
    }
    const conversation = resolveProjectConversation(store, project);
    const body = ResearchReportTaskSchema.parse(request.body ?? {});
    const providerKind = body.providerKind ?? conversation.providerKind;
    const model = body.model ?? conversation.model;
    const reasoningLevel = normalizeReasoningLevel(providerKind, model, body.reasoningLevel ?? conversation.reasoningLevel);
    void gateway.taskManager
      .enqueueDetachedTask({
        agentId: agent.id,
        conversationId: conversation.id,
        title: `Research report draft: ${project.title}`,
        prompt: [
          `Draft a research report for: ${project.title}`,
          project.objective,
          "Use only local AetherOps session artifacts, reports, flows, and evidence. Do not fabricate citations. Do not save automatically.",
          "Return sections: Objective, Method, Findings, Evidence table, Hypotheses and confidence, Uncertainties, Reproducibility notes, Next experiments.",
        ].join("\n\n"),
        providerKind,
        model,
        reasoningLevel,
        taskKind: "detached",
        startImmediately: body.autoStart,
      })
      .then((task) => response.json({ task }))
      .catch((error) => response.status(400).json({ error: error instanceof Error ? error.message : "Failed to create report task." }));
  });

  app.post("/api/research/projects/:projectId/subagents", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    const agent = store.getAgent(project.agentId);
    if (!agent) {
      response.status(404).json({ error: "Agent not found." });
      return;
    }
    const conversation = resolveProjectConversation(store, project);
    const body = ResearchSubagentSchema.parse(request.body ?? {});
    const question = body.questionId ? store.getResearchQuestion(body.questionId) : null;
    const rolePrompts: Record<typeof body.role, string> = {
      researcher: "Gather and organize local evidence for the selected research question.",
      critic: "Critique claims, identify weak evidence, and list missing assumptions.",
      verifier: "Verify claims against available local reports/artifacts and mark uncertainty.",
      synthesizer: "Synthesize evidence into a concise operator-ready summary.",
      "experiment-planner": "Propose the next bounded experiment or research loop with approval checkpoints.",
    };
    void gateway.taskManager
      .enqueueDetachedTask({
        agentId: agent.id,
        conversationId: conversation.id,
        title: `Research ${body.role}: ${project.title}`,
        prompt: [
          `Role: ${body.role}`,
          rolePrompts[body.role],
          `Project objective: ${project.objective}`,
          question ? `Question: ${question.question}` : "",
          body.prompt ?? "",
          "Stay within local AetherOps/opencode records. Do not execute external actions unless the operator creates an explicit approved flow.",
        ].filter(Boolean).join("\n\n"),
        providerKind: conversation.providerKind,
        model: conversation.model,
        reasoningLevel: conversation.reasoningLevel,
        taskKind: "subagent",
        nestingDepth: 1,
        startImmediately: body.autoStart,
      })
      .then((task) => response.json({ task }))
      .catch((error) => response.status(400).json({ error: error instanceof Error ? error.message : "Failed to create research subagent task." }));
  });

  app.get("/api/research/search", (request, response) => {
    const query = SearchQuerySchema.parse(request.query);
    const projects = store
      .listResearchProjects(query.agentId)
      .filter((project) => !query.conversationId || project.conversationId === query.conversationId);
    const results: Array<Record<string, unknown>> = [];
    const push = (item: Record<string, unknown>) => {
      if (results.length < 50) {
        results.push(item);
      }
    };
    for (const project of projects) {
      const projectHaystack = `${project.title}\n${project.objective}\n${project.domain ?? ""}`;
      if (projectHaystack.toLowerCase().includes(query.q.toLowerCase())) {
        push({ kind: "research_project", projectId: project.id, conversationId: project.conversationId, title: project.title, snippet: snippet(projectHaystack, query.q) });
      }
      for (const question of store.listResearchQuestions(project.id)) {
        if (question.question.toLowerCase().includes(query.q.toLowerCase())) {
          push({ kind: "question", projectId: project.id, questionId: question.id, title: question.question.slice(0, 120), snippet: snippet(question.question, query.q) });
        }
      }
      for (const hypothesis of store.listResearchHypotheses(project.id)) {
        if (hypothesis.hypothesis.toLowerCase().includes(query.q.toLowerCase())) {
          push({ kind: "hypothesis", projectId: project.id, hypothesisId: hypothesis.id, title: hypothesis.hypothesis.slice(0, 120), snippet: snippet(hypothesis.hypothesis, query.q) });
        }
      }
      for (const evidence of store.listResearchEvidence(project.id)) {
        const haystack = `${evidence.claim}\n${evidence.summary}\n${evidence.uncertainty ?? ""}`;
        if (haystack.toLowerCase().includes(query.q.toLowerCase())) {
          push({ kind: "evidence", projectId: project.id, evidenceId: evidence.id, title: evidence.claim.slice(0, 120), snippet: snippet(haystack, query.q), sourceType: evidence.sourceType, sourceRef: evidence.sourceRef });
        }
      }
    }
    response.json({ query: query.q, results, redacted: true, indexMode: "like" });
  });
}
