import type express from "express";
import { z } from "zod";
import { redactSensitiveText } from "../lib/redaction.js";
import type { AppStore } from "./context.js";

const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  agentId: z.string().min(1).max(120).optional(),
  conversationId: z.string().uuid().optional(),
});

function includesText(value: string | null | undefined, query: string) {
  return Boolean(value?.toLowerCase().includes(query.toLowerCase()));
}

function snippet(value: string | null | undefined, query: string) {
  const text = redactSensitiveText(value ?? "");
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

export function registerSearchRoutes(app: express.Express, params: { store: AppStore }) {
  const { store } = params;

  app.get("/api/search", (request, response) => {
    const query = SearchQuerySchema.parse(request.query);
    const conversations = (query.agentId
      ? store.listConversations(query.agentId)
      : store.listAgents().flatMap((agent) => store.listConversations(agent.id))
    ).filter((conversation) => !query.conversationId || conversation.id === query.conversationId);

    const results: Array<Record<string, unknown>> = [];
    const push = (result: Record<string, unknown>) => {
      if (results.length < 50) {
        results.push(result);
      }
    };

    for (const conversation of conversations) {
      if (includesText(conversation.title, query.q)) {
        push({
          kind: "session",
          conversationId: conversation.id,
          agentId: conversation.agentId,
          title: conversation.title,
          snippet: snippet(conversation.title, query.q),
        });
      }

      const summary = store.getSessionSummary(conversation.id);
      if (summary && includesText(`${summary.summary}\n${summary.decisions.join("\n")}\n${summary.nextActions.join("\n")}`, query.q)) {
        push({
          kind: "summary",
          conversationId: conversation.id,
          agentId: conversation.agentId,
          title: "Session summary",
          snippet: snippet(summary.summary, query.q),
        });
      }

      for (const flow of store.listTaskFlows?.(conversation.agentId).filter((item) => item.conversationId === conversation.id) ?? []) {
        if (includesText(`${flow.title}\n${flow.resultSummary ?? ""}\n${flow.errorText ?? ""}`, query.q)) {
          push({
            kind: "flow",
            conversationId: conversation.id,
            agentId: conversation.agentId,
            flowId: flow.id,
            title: flow.title,
            snippet: snippet(flow.resultSummary ?? flow.errorText ?? flow.title, query.q),
          });
        }
      }

      for (const task of store.listTasksForConversation?.(conversation.id) ?? []) {
        if (includesText(`${task.title}\n${task.resultText ?? ""}`, query.q)) {
          push({
            kind: "task",
            conversationId: conversation.id,
            agentId: conversation.agentId,
            taskId: task.id,
            runId: task.runId,
            title: task.title,
            snippet: snippet(task.resultText ?? task.title, query.q),
          });
        }
      }

      for (const run of store.listWorkspaceRuns(conversation.id)) {
        for (const artifact of store.listArtifactsForRun(conversation.id, run.id)) {
          const haystack = `${artifact.title}\n${artifact.summary ?? ""}\n${JSON.stringify(artifact.metadata ?? {})}`;
          if (includesText(haystack, query.q)) {
            push({
              kind: artifact.kind === "report" ? "report" : "artifact",
              conversationId: conversation.id,
              agentId: conversation.agentId,
              runId: run.id,
              artifactId: artifact.id,
              title: artifact.title,
              snippet: snippet(artifact.summary ?? artifact.title, query.q),
            });
          }
        }
      }
    }

    response.json({
      query: query.q,
      results,
      redacted: true,
      indexMode: "like",
    });
  });
}
