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
  type AppWorkspace,
} from "./context.js";
import { buildTaskFlowResponse } from "../lib/task-flow-response.js";
import { evaluateResearchBudget } from "../lib/research/budget-policy.js";
import { buildResearchLoopSteps } from "../lib/research/loop-planner.js";
import { buildResearchRagContext } from "../lib/research/rag-context.js";
import { buildResearchReportMarkdown } from "../lib/research/report-builder.js";
import { ensureSelfImprovementProject } from "../lib/research/self-improvement.js";
import { DEFAULT_EMBEDDING_STATUS } from "../lib/research/embedding-provider.js";

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

const ResearchProjectSessionLinkSchema = z.object({
  conversationId: z.string().uuid(),
  role: z.string().min(1).max(80).optional().default("member"),
  includeInContext: z.boolean().optional().default(true),
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

const ResearchSourceCreateSchema = z.object({
  evidenceId: z.string().uuid().optional().nullable(),
  url: z.string().url().max(2000).optional().nullable(),
  title: z.string().min(1).max(500),
  author: z.string().max(240).optional().nullable(),
  institution: z.string().max(240).optional().nullable(),
  publishedAt: z.string().max(80).optional().nullable(),
  accessedAt: z.string().max(80).optional().nullable(),
  summary: z.string().min(1).max(20_000),
  quote: z.string().max(20_000).optional().nullable(),
  snapshot: z.string().max(80_000).optional().nullable(),
  reliability: z.number().min(0).max(1).optional().default(0.5),
  relatedClaim: z.string().max(5000).optional().nullable(),
  metadata: z.record(z.unknown()).optional().default({}),
});

const ResearchLoopProposeSchema = z.object({
  questionId: z.string().uuid().optional().nullable(),
  goal: z.string().max(20_000).optional().nullable(),
  autoStart: z.boolean().optional().default(false),
});

const ResearchGoalControlSchema = z.object({
  questionId: z.string().uuid().optional().nullable(),
  goal: z.string().max(20_000).optional().nullable(),
  autoStart: z.boolean().optional().default(true),
  enableAutonomy: z.boolean().optional().default(true),
  workspaceMode: z.enum(["session", "repository"]).optional(),
});

const SelfImprovementGoalSchema = z.object({
  conversationId: z.string().uuid().optional().nullable(),
  goal: z.string().max(20_000).optional().nullable(),
  autoStart: z.boolean().optional().default(true),
  workspaceMode: z.enum(["session", "repository"]).optional().default("repository"),
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

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const RagSearchQuerySchema = ListQuerySchema.extend({
  q: z.string().min(1).max(500),
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

function dangerousAutoApproveEnabled() {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.AETHEROPS_OPENCODE_AUTO_APPROVE ?? process.env.AETHEROPS_OPENCODE_DANGEROUS_SKIP_PERMISSIONS ?? "")
      .trim()
      .toLowerCase(),
  );
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
    store.linkResearchProjectSession?.({
      projectId: project.id,
      conversationId: existing.id,
      role: "primary",
      includeInContext: true,
    });
    return existing;
  }
  const agent = store.getAgent(project.agentId);
  if (!agent) {
    throw new Error("Agent not found.");
  }
  const conversation =
    store.listConversations(agent.id)[0] ??
    store.saveConversation({
      agentId: agent.id,
      title: project.title,
      providerKind: agent.providerKind,
      model: agent.model,
      reasoningLevel: agent.reasoningLevel,
    });
  store.updateResearchProject?.({
    projectId: project.id,
    conversationId: conversation.id,
  });
  store.linkResearchProjectSession?.({
    projectId: project.id,
    conversationId: conversation.id,
    role: "primary",
    includeInContext: true,
  });
  return conversation;
}

function snippet(value: string, query: string) {
  const text = redactSensitiveText(value);
  const lower = text.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index < 0) {
    return text.slice(0, 240);
  }
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + query.length + 160);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}

export function registerResearchRoutes(
  app: express.Express,
  params: {
    store: AppStore;
    gateway: AppGateway;
    workspace: AppWorkspace;
  },
) {
  const { store, gateway, workspace } = params;

  function syncProjectWorkspace(projectId: string) {
    const project = store.getResearchProject(projectId);
    if (!project) {
      return null;
    }
    const sessions = store.listResearchProjectSessions(project.id).map((link) => ({
      ...link,
      title: store.getConversation(link.conversationId)?.title ?? link.conversationId,
    }));
    return workspace.writeResearchProjectSnapshot({
      project,
      sessions,
      questions: store.listResearchQuestions(project.id),
      hypotheses: store.listResearchHypotheses(project.id),
      evidence: store.listResearchEvidence(project.id),
      sources: store.listResearchSources(project.id),
      loops: store.listResearchLoops(project.id),
    });
  }

  function researchRagExtras(project: ResearchProjectRecord) {
    return {
      sessions: store.listResearchProjectSessions(project.id)
        .filter((link) => link.includeInContext)
        .map((link) => ({
          link,
          conversation: store.getConversation(link.conversationId),
          summary: store.getSessionSummary(link.conversationId),
          messages: store.listMessages(link.conversationId).slice(-8),
        })),
      projectFiles: syncProjectWorkspace(project.id)?.files ?? [],
    };
  }

  function findGoalQuestion(project: ResearchProjectRecord, questionId?: string | null, goal?: string | null) {
    const questions = store.listResearchQuestions(project.id);
    const selected =
      (questionId ? questions.find((item) => item.id === questionId) : null) ??
      questions.find((item) => item.status === "open" || item.status === "investigating") ??
      null;
    if (selected) {
      return { question: selected, questions };
    }
    const created = store.createResearchQuestion({
      projectId: project.id,
      question: goal?.trim() || project.objective,
      status: "open",
      priority: 50,
    });
    return { question: created, questions: [created, ...questions] };
  }

  async function createResearchLoopFlow(input: {
    project: ResearchProjectRecord;
    questionId?: string | null;
    goal?: string | null;
    autoStart: boolean;
    triggerSource?: "manual" | "schedule" | "event_hook";
  }) {
    const { question, questions } = findGoalQuestion(input.project, input.questionId, input.goal);
    const narrowedGoal = input.goal?.trim() || question.question;
    const ragResults = store.searchProjectRag({ projectId: input.project.id, q: narrowedGoal, limit: 6 }).results;
    const researchContext = buildResearchRagContext({
      project: input.project,
      question,
      goal: narrowedGoal,
      hypotheses: store.listResearchHypotheses(input.project.id),
      evidence: store.listResearchEvidence(input.project.id),
      sources: store.listResearchSources(input.project.id),
      ragResults,
      ...researchRagExtras(input.project),
    });
    const proposedSteps = buildResearchLoopSteps(input.project, question.question, narrowedGoal, researchContext);
    const budgetEvaluation = evaluateResearchBudget({
      project: input.project,
      loops: store.listResearchLoops(input.project.id),
      questions,
      proposedStepCount: proposedSteps.length,
      autoStart: input.autoStart,
      approvalGatePresent: proposedSteps.some((step) => step.stepKind === "approval_gate"),
      dangerousAutoApprove: dangerousAutoApproveEnabled(),
    });
    if (budgetEvaluation.blocked && input.autoStart) {
      return { error: true as const, budgetEvaluation };
    }
    const conversation = resolveProjectConversation(store, input.project);
    const loop = store.createResearchLoop({
      projectId: input.project.id,
      goal: narrowedGoal,
      selectedQuestionId: question.id,
    });
    const flowResult = await gateway.createFlow({
      agentId: input.project.agentId,
      conversationId: conversation.id,
      title: `${input.project.title}: ${question.question.slice(0, 80)}`,
      autoStart: false,
      triggerSource: input.triggerSource ?? "manual",
      steps: proposedSteps,
    });
    const updatedLoop = store.transitionResearchLoop({
      loopId: loop.id,
      proposedFlowId: flowResult.flow.id,
      status: input.autoStart ? "running" : "queued",
      clearErrorText: true,
      clearCompletedAt: true,
    })!;
    syncProjectWorkspace(input.project.id);
    if (input.autoStart) {
      await gateway.taskManager.startTaskFlow(flowResult.flow.id);
    }
    const flow = store.getTaskFlow(flowResult.flow.id) ?? flowResult.flow;
    return {
      error: false as const,
      loop: store.getResearchLoop(updatedLoop.id),
      flow: buildTaskFlowResponse(store, flow).flow,
      steps: buildTaskFlowResponse(store, flow).steps,
      budgetEvaluation,
      question,
    };
  }

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
    const project = store.createResearchProject({
        agentId: agent.id,
        conversationId: body.conversationId ?? null,
        title: body.title,
        objective: body.objective,
        domain: body.domain ?? null,
        autonomyEnabled: body.autonomyEnabled,
        autonomyBudget: mergeBudget(body.autonomyBudget),
        safetyPolicy: mergePolicy(body.safetyPolicy),
      });
    const files = syncProjectWorkspace(project.id);
    response.json({
      project,
      sessions: store.listResearchProjectSessions(project.id),
      files,
    });
  });

  app.get("/api/research/projects/:projectId", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    response.json({
      project,
      sessions: store.listResearchProjectSessions(project.id),
      files: syncProjectWorkspace(project.id),
      questions: store.listResearchQuestions(project.id),
      hypotheses: store.listResearchHypotheses(project.id),
      evidence: store.listResearchEvidence(project.id),
      sources: store.listResearchSources(project.id),
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
      conversationId: body.conversationId,
      title: body.title,
      objective: body.objective,
      domain: body.domain,
      status: body.status,
      autonomyEnabled: body.autonomyEnabled,
      autonomyBudget: body.autonomyBudget ? mergeBudget(body.autonomyBudget) : undefined,
      safetyPolicy: body.safetyPolicy ? mergePolicy(body.safetyPolicy) : undefined,
    });
    const files = updated ? syncProjectWorkspace(updated.id) : null;
    response.json({ project: updated, sessions: updated ? store.listResearchProjectSessions(updated.id) : [], files });
  });

  app.get("/api/research/projects/:projectId/sessions", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    response.json({
      sessions: store.listResearchProjectSessions(project.id).map((link) => ({
        ...link,
        conversation: store.getConversation(link.conversationId),
        summary: store.getSessionSummary(link.conversationId),
      })),
    });
  });

  app.post("/api/research/projects/:projectId/sessions", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    const body = ResearchProjectSessionLinkSchema.parse(request.body);
    const link = store.linkResearchProjectSession({
      projectId: project.id,
      conversationId: body.conversationId,
      role: body.role,
      includeInContext: body.includeInContext,
    });
    const files = syncProjectWorkspace(project.id);
    response.json({ session: link, sessions: store.listResearchProjectSessions(project.id), files });
  });

  app.delete("/api/research/projects/:projectId/sessions/:conversationId", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    const deleted = store.unlinkResearchProjectSession(project.id, request.params.conversationId);
    const files = syncProjectWorkspace(project.id);
    response.json({ deleted, sessions: store.listResearchProjectSessions(project.id), files });
  });

  app.get("/api/research/projects/:projectId/files", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    response.json(syncProjectWorkspace(project.id));
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
    const question = store.createResearchQuestion({
        projectId: project.id,
        question: body.question,
        status: body.status,
        priority: body.priority,
      });
    syncProjectWorkspace(project.id);
    response.json({ question });
  });

  app.patch("/api/research/questions/:questionId", (request, response) => {
    const existing = store.getResearchQuestion(request.params.questionId);
    if (!existing) {
      response.status(404).json({ error: "Research question not found." });
      return;
    }
    const body = ResearchQuestionPatchSchema.parse(request.body);
    const question = store.updateResearchQuestion({
        questionId: existing.id,
        question: body.question,
        status: body.status,
        priority: body.priority,
      });
    if (question) syncProjectWorkspace(question.projectId);
    response.json({ question });
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
    const hypothesis = store.createResearchHypothesis({
        projectId: project.id,
        questionId: body.questionId ?? null,
        hypothesis: body.hypothesis,
        status: body.status,
        confidence: body.confidence,
      });
    syncProjectWorkspace(project.id);
    response.json({ hypothesis });
  });

  app.patch("/api/research/hypotheses/:hypothesisId", (request, response) => {
    const existing = store.getResearchHypothesis(request.params.hypothesisId);
    if (!existing) {
      response.status(404).json({ error: "Research hypothesis not found." });
      return;
    }
    const body = ResearchHypothesisPatchSchema.parse(request.body);
    const hypothesis = store.updateResearchHypothesis({
        hypothesisId: existing.id,
        questionId: body.questionId,
        hypothesis: body.hypothesis,
        status: body.status,
        confidence: body.confidence,
      });
    if (hypothesis) syncProjectWorkspace(hypothesis.projectId);
    response.json({ hypothesis });
  });

  app.get("/api/research/projects/:projectId/evidence", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    const query = ListQuerySchema.parse(request.query);
    const evidence = store.listResearchEvidence(project.id);
    response.json({
      evidence: evidence.slice(query.offset, query.offset + query.limit),
      pagination: { total: evidence.length, limit: query.limit, offset: query.offset },
    });
  });

  app.post("/api/research/projects/:projectId/evidence", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    const body = ResearchEvidenceCreateSchema.parse(request.body);
    const evidence = store.createResearchEvidence({
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
      });
    syncProjectWorkspace(project.id);
    response.json({ evidence });
  });

  app.get("/api/research/projects/:projectId/sources", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) return;
    const query = ListQuerySchema.parse(request.query);
    const sources = store.listResearchSources(project.id);
    response.json({
      sources: sources.slice(query.offset, query.offset + query.limit),
      pagination: { total: sources.length, limit: query.limit, offset: query.offset },
    });
  });

  app.post("/api/research/projects/:projectId/sources", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) return;
    const body = ResearchSourceCreateSchema.parse(request.body);
    const source = store.createResearchSource({
        projectId: project.id,
        evidenceId: body.evidenceId ?? null,
        url: body.url ?? null,
        title: redactSensitiveText(body.title),
        author: body.author ? redactSensitiveText(body.author) : null,
        institution: body.institution ? redactSensitiveText(body.institution) : null,
        publishedAt: body.publishedAt ?? null,
        accessedAt: body.accessedAt ?? null,
        summary: redactSensitiveText(body.summary),
        quote: body.quote ? redactSensitiveText(body.quote) : null,
        snapshot: body.snapshot ? redactSensitiveText(body.snapshot) : null,
        reliability: body.reliability,
        relatedClaim: body.relatedClaim ? redactSensitiveText(body.relatedClaim) : null,
        metadata: body.metadata,
      });
    syncProjectWorkspace(project.id);
    response.json({ source });
  });

  app.get("/api/research/projects/:projectId/rag-context", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) return;
    const questions = store.listResearchQuestions(project.id);
    const requestedQuestionId = typeof request.query.questionId === "string" ? request.query.questionId : null;
    const question =
      (requestedQuestionId ? questions.find((item) => item.id === requestedQuestionId) : null) ??
      questions.find((item) => item.status === "open" || item.status === "investigating") ??
      questions[0] ??
      null;
    const goal = typeof request.query.q === "string" ? request.query.q : question?.question ?? project.objective;
    const ragResults = store.searchProjectRag({ projectId: project.id, q: goal, limit: 6 }).results;
    response.json({
      context: buildResearchRagContext({
        project,
        question,
        goal,
        hypotheses: store.listResearchHypotheses(project.id),
        evidence: store.listResearchEvidence(project.id),
        sources: store.listResearchSources(project.id),
        ragResults,
        ...researchRagExtras(project),
      }),
      ragResults,
    });
  });

  app.post("/api/research/projects/:projectId/rag/rebuild", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) return;
    const rag = store.rebuildProjectRagIndex(project.id);
    response.json({
      project,
      rag: {
        ...rag,
        embedding: DEFAULT_EMBEDDING_STATUS,
      },
    });
  });

  app.get("/api/research/projects/:projectId/rag/search", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) return;
    const query = RagSearchQuerySchema.parse(request.query);
    const search = store.searchProjectRag({
      projectId: project.id,
      q: query.q,
      limit: query.limit,
      offset: query.offset,
    });
    response.json({
      projectId: project.id,
      query: query.q,
      redacted: true,
      ...search,
    });
  });

  app.get("/api/research/projects/:projectId/loops", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    const query = ListQuerySchema.parse(request.query);
    const loops = store.listResearchLoops(project.id);
    response.json({
      loops: loops.slice(query.offset, query.offset + query.limit),
      pagination: { total: loops.length, limit: query.limit, offset: query.offset },
    });
  });

  app.post("/api/research/projects/:projectId/loops/propose", async (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    const body = ResearchLoopProposeSchema.parse(request.body ?? {});
    const questions = store.listResearchQuestions(project.id);
    const question =
      (body.questionId ? questions.find((item) => item.id === body.questionId) : null) ??
      questions.find((item) => item.status === "open" || item.status === "investigating") ??
      null;
    const narrowedGoal = body.goal?.trim() || question?.question || project.objective;
    const ragResults = store.searchProjectRag({ projectId: project.id, q: narrowedGoal, limit: 6 }).results;
    const researchContext = question
      ? buildResearchRagContext({
          project,
          question,
          goal: narrowedGoal,
          hypotheses: store.listResearchHypotheses(project.id),
          evidence: store.listResearchEvidence(project.id),
          sources: store.listResearchSources(project.id),
          ragResults,
          ...researchRagExtras(project),
        })
      : null;
    const proposedSteps = question ? buildResearchLoopSteps(project, question.question, narrowedGoal, researchContext) : [];
    const budgetEvaluation = evaluateResearchBudget({
      project,
      loops: store.listResearchLoops(project.id),
      questions,
      proposedStepCount: proposedSteps.length,
      autoStart: body.autoStart,
      approvalGatePresent: proposedSteps.some((step) => step.stepKind === "approval_gate"),
      dangerousAutoApprove: dangerousAutoApproveEnabled(),
    });
    if (budgetEvaluation.blocked && (body.autoStart || !question || project.status !== "active")) {
      response.status(409).json({
        error: "Research loop budget check failed.",
        reasons: budgetEvaluation.errors,
        warnings: budgetEvaluation.warnings,
        evaluation: budgetEvaluation,
      });
      return;
    }
    if (!question) {
      response.status(409).json({ error: "At least one open research question is required." });
      return;
    }
    const conversation = resolveProjectConversation(store, project);
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
      steps: proposedSteps,
    });
    const updatedLoop = store.transitionResearchLoop({
      loopId: loop.id,
      proposedFlowId: flowResult.flow.id,
      status: body.autoStart ? "running" : "queued",
    })!;
    syncProjectWorkspace(project.id);
    if (body.autoStart) {
      await gateway.taskManager.startTaskFlow(flowResult.flow.id);
    }
    const flow = store.getTaskFlow(flowResult.flow.id) ?? flowResult.flow;
    response.json({
      loop: store.getResearchLoop(updatedLoop.id),
      flow: buildTaskFlowResponse(store, flow).flow,
      steps: buildTaskFlowResponse(store, flow).steps,
      budget: budgetEvaluation,
    });
  });

  app.post("/api/research/projects/:projectId/goal/start", async (request, response) => {
    const existing = requireResearchProject(store, response, request.params.projectId);
    if (!existing) {
      return;
    }
    const body = ResearchGoalControlSchema.parse(request.body ?? {});
    const project = body.enableAutonomy
      ? store.updateResearchProject({
          projectId: existing.id,
          status: "active",
          autonomyEnabled: true,
          safetyPolicy: body.workspaceMode
            ? mergePolicy({
                ...existing.safetyPolicy,
                workspaceMode: body.workspaceMode,
              })
            : existing.safetyPolicy,
        }) ?? existing
      : existing;
    const result = await createResearchLoopFlow({
      project,
      questionId: body.questionId ?? null,
      goal: body.goal ?? null,
      autoStart: body.autoStart,
      triggerSource: "schedule",
    });
    if (result.error) {
      response.status(409).json({
        error: "Goal runner budget check failed.",
        reasons: result.budgetEvaluation.errors,
        warnings: result.budgetEvaluation.warnings,
        evaluation: result.budgetEvaluation,
      });
      return;
    }
    response.json({
      project: store.getResearchProject(project.id),
      loop: result.loop,
      flow: result.flow,
      steps: result.steps,
      budget: result.budgetEvaluation,
      mode: "goal_runner",
    });
  });

  app.post("/api/research/projects/:projectId/goal/tick", async (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    const loops = store.listResearchLoops(project.id);
    const activeLoop =
      loops.find((loop) => loop.status === "running" || loop.status === "waiting_approval") ??
      loops.find((loop) => loop.status === "queued") ??
      null;
    if (activeLoop?.proposedFlowId) {
      const flow = store.getTaskFlow(activeLoop.proposedFlowId);
      if (flow && (flow.status === "queued" || flow.status === "running")) {
        await gateway.taskManager.startTaskFlow(flow.id);
      } else if (flow && ["completed", "failed", "cancelled"].includes(flow.status)) {
        store.syncResearchLoopsForFlow(flow.id);
      }
      response.json({
        project: store.getResearchProject(project.id),
        loop: store.getResearchLoop(activeLoop.id),
        flow: activeLoop.proposedFlowId ? store.getTaskFlow(activeLoop.proposedFlowId) : null,
        mode: "goal_runner_tick",
        action: "continued_existing_loop",
      });
      return;
    }
    const result = await createResearchLoopFlow({
      project,
      questionId: null,
      goal: null,
      autoStart: project.autonomyEnabled,
      triggerSource: "schedule",
    });
    if (result.error) {
      response.status(409).json({
        error: "Goal runner budget check failed.",
        reasons: result.budgetEvaluation.errors,
        warnings: result.budgetEvaluation.warnings,
        evaluation: result.budgetEvaluation,
      });
      return;
    }
    response.json({
      project: store.getResearchProject(project.id),
      loop: result.loop,
      flow: result.flow,
      steps: result.steps,
      budget: result.budgetEvaluation,
      mode: "goal_runner_tick",
      action: "created_next_loop",
    });
  });

  app.post("/api/research/projects/:projectId/goal/stop", (request, response) => {
    const project = requireResearchProject(store, response, request.params.projectId);
    if (!project) {
      return;
    }
    response.json({
      project: store.updateResearchProject({
        projectId: project.id,
        autonomyEnabled: false,
      }),
      mode: "goal_runner",
      stopped: true,
    });
  });

  app.post("/api/research/agents/:agentId/self-improvement-goal", async (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    const body = SelfImprovementGoalSchema.parse(request.body ?? {});
    if (body.conversationId) {
      const conversation = store.getConversation(body.conversationId);
      if (!conversation || conversation.agentId !== agent.id) {
        response.status(404).json({ error: "Session not found for self-improvement goal." });
        return;
      }
    }
    const { project, question } = ensureSelfImprovementProject({
      store,
      agentId: agent.id,
      conversationId: body.conversationId ?? null,
      workspaceMode: body.workspaceMode,
    });
    const result = await createResearchLoopFlow({
      project,
      questionId: question.id,
      goal: body.goal?.trim() || question.question,
      autoStart: body.autoStart,
      triggerSource: "manual",
    });
    if (result.error) {
      response.status(409).json({
        error: "Self-improvement goal budget check failed.",
        reasons: result.budgetEvaluation.errors,
        warnings: result.budgetEvaluation.warnings,
        evaluation: result.budgetEvaluation,
      });
      return;
    }
    response.json({
      project: store.getResearchProject(project.id),
      question: store.listResearchQuestions(project.id).find((item) => item.id === question.id) ?? question,
      loop: result.loop,
      flow: result.flow,
      steps: result.steps,
      budget: result.budgetEvaluation,
      mode: "self_improvement_goal",
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
    const project = store.getResearchProject(loop.projectId);
    if (!project) {
      response.status(404).json({ error: "Research project not found." });
      return;
    }
    const flowSteps = store.listTaskFlowSteps(loop.proposedFlowId);
    const budgetEvaluation = evaluateResearchBudget({
      project,
      loops: store.listResearchLoops(project.id).filter((item) => item.id !== loop.id),
      questions: store.listResearchQuestions(project.id),
      proposedStepCount: flowSteps.length,
      manualStart: true,
      approvalGatePresent: flowSteps.some((step) => step.stepKind === "approval_gate"),
      dangerousAutoApprove: dangerousAutoApproveEnabled(),
    });
    if (budgetEvaluation.blocked) {
      response.status(409).json({
        error: "Research loop budget check failed.",
        reasons: budgetEvaluation.errors,
        warnings: budgetEvaluation.warnings,
        evaluation: budgetEvaluation,
      });
      return;
    }
    await gateway.taskManager.startTaskFlow(loop.proposedFlowId);
    response.json({
      loop: store.transitionResearchLoop({ loopId: loop.id, status: "running", clearErrorText: true }),
      flow: store.getTaskFlow(loop.proposedFlowId),
      budget: budgetEvaluation,
    });
  });

  app.post("/api/research/loops/:loopId/tick", async (request, response) => {
    const loop = store.getResearchLoop(request.params.loopId);
    if (!loop) {
      response.status(404).json({ error: "Research loop not found." });
      return;
    }
    if (!loop.proposedFlowId) {
      response.status(409).json({ error: "Research loop has no linked flow to tick." });
      return;
    }
    const flow = store.getTaskFlow(loop.proposedFlowId);
    if (!flow) {
      response.status(404).json({ error: "Linked task flow not found." });
      return;
    }
    let action: "started_flow" | "synced_terminal_flow" | "waiting_for_flow" = "waiting_for_flow";
    if (flow.status === "queued" || flow.status === "running") {
      await gateway.taskManager.startTaskFlow(flow.id);
      action = "started_flow";
    } else if (["completed", "failed", "cancelled"].includes(flow.status)) {
      store.syncResearchLoopsForFlow(flow.id);
      action = "synced_terminal_flow";
    }
    const updatedLoop = store.getResearchLoop(loop.id);
    response.json({
      loop: updatedLoop,
      flow: store.getTaskFlow(flow.id),
      action,
      summary: updatedLoop
        ? {
            loopId: updatedLoop.id,
            status: updatedLoop.status,
            flowId: updatedLoop.proposedFlowId,
            questionId: updatedLoop.selectedQuestionId,
            evidenceCount: store.listResearchEvidence(updatedLoop.projectId).length,
            sourceCount: store.listResearchSources(updatedLoop.projectId).length,
            resultSummary: updatedLoop.resultSummary,
            nextAction:
              updatedLoop.status === "completed"
                ? "Review the evidence ledger and propose the next loop if questions remain."
                : "Continue the linked flow or resolve any approval gate.",
          }
        : null,
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
    {
    const budgetEvaluation = evaluateResearchBudget({
      project,
      loops,
      questions,
      approvalGatePresent: true,
      dangerousAutoApprove: dangerousAutoApproveEnabled(),
    });
    const checks: Array<{ id: string; label: string; status: "ok" | "warn" | "error"; message: string }> = [
      ...budgetEvaluation.checks,
      agent
        ? { id: "agent", label: "Agent", status: "ok", message: `${agent.name} 에이전트가 연결되어 있습니다.` }
        : { id: "agent", label: "Agent", status: "error", message: "연결된 에이전트를 찾을 수 없습니다." },
    ];
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
              message: engine.authEvidence?.message ?? engine.lastFailure ?? "opencode 상태를 확인하지 못했습니다.",
            },
      );
      checks.push(
        engine.environment.autoApprovePermissions
          ? {
              id: "permissions",
              label: "Permissions",
              status: "warn",
              message: "위험한 opencode 권한 자동 승인 플래그가 켜져 있습니다. 연구 실행 전 확인이 필요합니다.",
            }
          : {
              id: "permissions",
              label: "Permissions",
              status: "ok",
              message: "위험한 opencode 권한 자동 승인 플래그가 꺼져 있습니다.",
            },
      );
    }
    const displayChecks = checks.map((check) => {
      if (check.id === "agent") {
        return agent
          ? { ...check, message: `${agent.name} agent is connected.` }
          : { ...check, message: "Linked agent could not be found." };
      }
      if (check.id === "permissions") {
        return check.status === "warn"
          ? { ...check, message: "Dangerous opencode auto-approval is enabled. Review research execution carefully." }
          : { ...check, message: "Dangerous opencode auto-approval is disabled." };
      }
      if (check.id === "opencode" && check.message.includes("?")) {
        return { ...check, message: "opencode status needs review before autonomous research execution." };
      }
      return check;
    });
    response.json({
      ok: !displayChecks.some((check) => check.status === "error"),
      checks: displayChecks,
      budget: project.autonomyBudget,
      safetyPolicy: project.safetyPolicy,
      evaluation: budgetEvaluation,
    });
    return;
    }
    /*
    const checks: Array<{ id: string; label: string; status: "ok" | "warn" | "error"; message: string }> = [
      ...budgetEvaluation.checks,
      agent
        ? { id: "agent", label: "Agent", status: "ok", message: `${agent.name} ?먯씠?꾪듃媛 ?곌껐?섏뼱 ?덉뒿?덈떎.` }
        : { id: "agent", label: "Agent", status: "error", message: "?곌껐???먯씠?꾪듃瑜?李얠쓣 ???놁뒿?덈떎." },
    ];
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
              message: engine.authEvidence?.message ?? engine.lastFailure ?? "opencode 以鍮??곹깭瑜??뺤씤?댁빞 ?⑸땲??",
            },
      );
      checks.push(
        engine.environment.autoApprovePermissions
          ? {
              id: "permissions",
              label: "Permissions",
              status: "warn",
              message: "?꾪뿕 沅뚰븳 ?먮룞 ?뱀씤 ?뚮옒洹멸? 耳쒖졇 ?덉뒿?덈떎. ?곌뎄 ?ㅽ뻾 ???뺤씤???꾩슂?⑸땲??",
            }
          : {
              id: "permissions",
              label: "Permissions",
              status: "ok",
              message: "?꾪뿕 沅뚰븳 ?먮룞 ?뱀씤 ?뚮옒洹멸? 爰쇱졇 ?덉뒿?덈떎.",
            },
      );
    }
    response.json({
      ok: !checks.some((check) => check.status === "error"),
      checks,
      budget: project.autonomyBudget,
      safetyPolicy: project.safetyPolicy,
      evaluation: budgetEvaluation,
    });
    return;
    */
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
      for (const source of store.listResearchSources(project.id)) {
        const haystack = `${source.title}\n${source.url ?? ""}\n${source.author ?? ""}\n${source.institution ?? ""}\n${source.summary}\n${source.quote ?? ""}\n${source.relatedClaim ?? ""}`;
        if (haystack.toLowerCase().includes(query.q.toLowerCase())) {
          push({
            kind: "source",
            projectId: project.id,
            title: source.title,
            snippet: snippet(haystack, query.q),
            sourceType: "external",
            sourceRef: source.url ?? source.id,
          });
        }
      }
    }
    response.json({ query: query.q, results, redacted: true, indexMode: "like" });
  });
}
