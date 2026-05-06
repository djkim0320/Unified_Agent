import type express from "express";
import type { createStore } from "../db.js";
import type { createAgentGateway } from "../lib/agent-gateway.js";
import type { createWorkspaceManager } from "../lib/workspace.js";
import type {
  AutomationRuleRecord,
  TaskFlowRecord,
} from "../types.js";

export type AppStore = ReturnType<typeof createStore>;
export type AppWorkspace = ReturnType<typeof createWorkspaceManager>;
export type AppGateway = ReturnType<typeof createAgentGateway>;

export function requireAgent(store: AppStore, response: express.Response, agentId: string) {
  const agent = store.getAgent(agentId);
  if (!agent) {
    response.status(404).json({ error: "Agent not found" });
    return null;
  }
  return agent;
}

export function requireConversation(
  store: AppStore,
  response: express.Response,
  conversationId: string,
) {
  const conversation = store.getConversation(conversationId);
  if (!conversation) {
    response.status(404).json({ error: "Conversation not found" });
    return null;
  }
  return conversation;
}

export function requireTaskFlow(store: AppStore, response: express.Response, flowId: string) {
  const flow = store.getTaskFlow?.(flowId) ?? null;
  if (!flow) {
    response.status(404).json({ error: "Task flow not found" });
    return null;
  }
  return flow;
}

export function requireTaskFlowStep(
  store: AppStore,
  response: express.Response,
  flow: TaskFlowRecord,
  stepId: string,
) {
  const step = store.getTaskFlowStep?.(stepId) ?? null;
  if (!step || step.flowId !== flow.id) {
    response.status(404).json({ error: "Task flow step not found" });
    return null;
  }
  return step;
}

export function requireAutomationRule(
  store: AppStore,
  response: express.Response,
  agentId: string,
  ruleId: string,
): AutomationRuleRecord | null {
  const rule = store.getAutomationRuleForAgent?.(agentId, ruleId) ?? null;
  if (!rule) {
    response.status(404).json({ error: "Automation rule not found" });
    return null;
  }
  return rule;
}
