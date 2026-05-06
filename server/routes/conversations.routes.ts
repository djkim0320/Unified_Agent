import type express from "express";
import { z } from "zod";
import { DEFAULT_AGENT_ID, DEFAULT_CONVERSATION_TITLE } from "../db.js";
import { getProviderAdapter } from "../provider-registry.js";
import { normalizeReasoningLevel } from "../reasoning-options.js";
import { ProviderKindSchema, ReasoningLevelSchema } from "../schemas/common.js";
import {
  requireAgent,
  requireConversation,
  type AppGateway,
  type AppStore,
  type AppWorkspace,
} from "./context.js";

const ConversationUpsertSchema = z.object({
  conversationId: z.string().uuid().optional(),
  agentId: z.string().min(1).max(120).optional(),
  title: z.string().min(1).max(120).optional(),
  providerKind: ProviderKindSchema.optional(),
  model: z.string().min(1).max(120).optional(),
  reasoningLevel: ReasoningLevelSchema.optional(),
});

const SubagentCreateSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  prompt: z.string().min(1).max(20_000),
  providerKind: ProviderKindSchema.optional(),
  model: z.string().min(1).max(120).optional(),
  reasoningLevel: ReasoningLevelSchema.optional(),
});

const SessionSummarySaveSchema = z.object({
  summary: z.string().max(20_000),
  decisions: z.array(z.string().max(500)).max(20).optional().default([]),
  openQuestions: z.array(z.string().max(500)).max(20).optional().default([]),
  nextActions: z.array(z.string().max(500)).max(20).optional().default([]),
});

function clip(text: string, maxLength = 220) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function stringArrayFromRunPayload(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function buildDeterministicSummary(store: AppStore, conversationId: string) {
  const conversation = store.getConversation(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found.");
  }
  const messages = store.listMessages(conversationId).slice(-12);
  const runs = store.listWorkspaceRuns(conversationId).slice(0, 5);
  const latestRun = runs[0] ?? null;
  const latestEvents = latestRun ? store.listWorkspaceRunEvents(conversationId, latestRun.id).slice(-12) : [];
  const changedFiles = [
    ...new Set(
      latestEvents.flatMap((event) => stringArrayFromRunPayload(event.payload.changedFiles)),
    ),
  ].slice(0, 12);
  const flows = store.listTaskFlows?.(conversation.agentId).filter((flow) => flow.conversationId === conversationId) ?? [];
  const tasks = store.listTasksForConversation?.(conversationId).slice(0, 5) ?? [];
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const completedRuns = runs.filter((run) => run.status === "completed").length;
  const failedRuns = runs.filter((run) => run.status === "failed" || run.status === "cancelled").length;

  return {
    summary: [
      `현재 목표: ${clip(lastUserMessage || conversation.title || "아직 명확한 목표가 없습니다.")}`,
      `완료된 작업: 최근 ${runs.length}개 실행 중 완료 ${completedRuns}개, 실패/취소 ${failedRuns}개입니다.`,
      changedFiles.length ? `최근 변경 파일: ${changedFiles.join(", ")}` : "최근 변경 파일은 아직 없습니다.",
      flows.length ? `연결된 Flow: ${flows.map((flow) => `${flow.title}(${flow.status})`).join(", ")}` : "연결된 Flow는 아직 없습니다.",
      tasks.length ? `최근 Task: ${tasks.map((task) => `${task.title}(${task.status})`).join(", ")}` : "최근 Task는 아직 없습니다.",
    ].join("\n"),
    decisions: flows
      .filter((flow) => flow.resultSummary)
      .slice(0, 5)
      .map((flow) => `${flow.title}: ${clip(flow.resultSummary ?? "", 140)}`),
    openQuestions: latestRun?.status === "failed" ? [`최근 실행 실패를 확인해야 합니다: ${clip(latestRun.userMessage)}`] : [],
    nextActions: [
      flows.some((flow) => flow.status === "queued" || flow.status === "running")
        ? "진행 중이거나 대기 중인 Flow를 확인합니다."
        : "다음 요청을 채팅으로 입력하거나 Flow 초안을 생성합니다.",
    ],
  };
}

export function registerConversationsRoutes(
  app: express.Express,
  params: {
    store: AppStore;
    workspace: AppWorkspace;
    gateway: AppGateway;
  },
) {
  const { store, workspace, gateway } = params;

  app.get("/api/conversations", (request, response) => {
    const agentId = typeof request.query.agentId === "string" ? request.query.agentId : undefined;
    if (agentId && !requireAgent(store, response, agentId)) {
      return;
    }
    response.json({
      conversations: store.listConversations(agentId),
    });
  });

  app.post("/api/conversations", (request, response) => {
    const body = ConversationUpsertSchema.parse(request.body);
    const existing = body.conversationId ? store.getConversation(body.conversationId) : null;
    const agentId = body.agentId ?? existing?.agentId ?? DEFAULT_AGENT_ID;
    const agent = requireAgent(store, response, agentId);
    if (!agent) {
      return;
    }
    const providerKind = body.providerKind ?? existing?.providerKind ?? agent.providerKind;
    const model = body.model ?? existing?.model ?? agent.model ?? getProviderAdapter(providerKind).defaultModel;
    const reasoningLevel = normalizeReasoningLevel(
      providerKind,
      model,
      body.reasoningLevel ?? existing?.reasoningLevel ?? agent.reasoningLevel,
    );
    const normalizedConversationTitle = body.title ?? existing?.title ?? DEFAULT_CONVERSATION_TITLE;
    const conversation = store.saveConversation({
      id: body.conversationId,
      agentId: agent.id,
      channelKind: existing?.channelKind,
      title: normalizedConversationTitle,
      providerKind,
      model,
      reasoningLevel,
    });
    store.saveAgent({
      id: agent.id,
      name: agent.name,
      providerKind,
      model,
      reasoningLevel,
    });
    workspace.createAgentWorkspace(agent.id);
    workspace.createConversationWorkspace(conversation.id);
    response.json({ conversation });
  });

  app.get("/api/conversations/:id/messages", (request, response) => {
    const conversation = store.getConversation(request.params.id);
    if (!conversation) {
      response.status(404).json({ error: "Conversation not found" });
      return;
    }
    response.json({
      conversation,
      messages: store.listMessages(conversation.id),
    });
  });

  app.get("/api/conversations/:id/summary", (request, response) => {
    const conversation = requireConversation(store, response, request.params.id);
    if (!conversation) {
      return;
    }
    response.json({
      summary: store.getSessionSummary(conversation.id),
    });
  });

  app.put("/api/conversations/:id/summary", (request, response) => {
    const conversation = requireConversation(store, response, request.params.id);
    if (!conversation) {
      return;
    }
    const body = SessionSummarySaveSchema.parse(request.body);
    response.json({
      summary: store.saveSessionSummary({
        conversationId: conversation.id,
        summary: body.summary,
        decisions: body.decisions,
        openQuestions: body.openQuestions,
        nextActions: body.nextActions,
      }),
    });
  });

  app.post("/api/conversations/:id/summary/refresh", (request, response) => {
    const conversation = requireConversation(store, response, request.params.id);
    if (!conversation) {
      return;
    }
    const generated = buildDeterministicSummary(store, conversation.id);
    response.json({
      summary: store.saveSessionSummary({
        conversationId: conversation.id,
        ...generated,
      }),
    });
  });

  app.delete("/api/conversations/:id", async (request, response) => {
    const conversation = store.getConversation(request.params.id);
    if (!conversation) {
      response.status(404).json({ error: "Conversation not found" });
      return;
    }
    try {
      await workspace.deleteConversationWorkspace(conversation.id);
    } catch {
      // Workspace cleanup is best-effort, but deleteConversationWorkspace is scoped to this sandbox only.
    }
    const deleted = store.deleteConversation(conversation.id);
    if (!deleted) {
      response.status(404).json({ error: "Conversation not found" });
      return;
    }
    response.json({ ok: true });
  });

  app.get("/api/sessions/:sessionId/subagents", (request, response) => {
    const parentConversation = requireConversation(store, response, request.params.sessionId);
    if (!parentConversation) {
      return;
    }
    response.json({
      sessions: store.listConversations(parentConversation.agentId, {
        sessionKind: "subagent",
        parentConversationId: parentConversation.id,
      }),
    });
  });

  app.post("/api/sessions/:sessionId/subagents", (request, response) => {
    const parentConversation = requireConversation(store, response, request.params.sessionId);
    if (!parentConversation) {
      return;
    }
    const body = SubagentCreateSchema.parse(request.body);
    const providerKind = body.providerKind ?? parentConversation.providerKind;
    const model = body.model ?? parentConversation.model;
    const reasoningLevel = normalizeReasoningLevel(
      providerKind,
      model,
      body.reasoningLevel ?? parentConversation.reasoningLevel,
    );
    const parentRun = store.listWorkspaceRuns(parentConversation.id)[0] ?? null;
    if (!parentRun) {
      response.status(409).json({ error: "A parent run must exist before spawning a sub-agent session." });
      return;
    }
    void gateway
      .spawnSubagentSession({
        agentId: parentConversation.agentId,
        parentConversationId: parentConversation.id,
        parentRunId: parentRun.id,
        title: body.title,
        prompt: body.prompt,
        providerKind,
        model,
        reasoningLevel,
      })
      .then((result) => {
        response.json(result);
      })
      .catch((error) => {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Failed to spawn sub-agent session.",
        });
      });
  });

  app.post("/api/subagents/:sessionId/cancel", (request, response) => {
    const childConversation = requireConversation(store, response, request.params.sessionId);
    if (!childConversation) {
      return;
    }
    if (childConversation.sessionKind !== "subagent") {
      response.status(400).json({ error: "Session is not a sub-agent session." });
      return;
    }
    const task = store
      .listTasks(childConversation.agentId)
      .find(
        (candidate) =>
          candidate.conversationId === childConversation.id &&
          (candidate.status === "queued" || candidate.status === "running"),
      );
    if (!task) {
      response.json({ ok: true, task: null });
      return;
    }
    void gateway.taskManager
      .cancelTask(task.id)
      .then((updated) => {
        response.json({ ok: true, task: updated ?? store.getTask(task.id) });
      })
      .catch((error) => {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Failed to cancel sub-agent task.",
        });
      });
  });
}
