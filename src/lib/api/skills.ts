import { apiRequest } from "../../apiClient";
import type {
  AgentHeartbeatRecord,
  SkillTemplateRecord,
  StandingOrdersRecord,
} from "../../types";

export async function listSkillTemplates(agentId?: string | null, signal?: AbortSignal) {
  const path = agentId ? `/api/skill-templates?agentId=${encodeURIComponent(agentId)}` : "/api/skill-templates";
  return apiRequest<{ templates: SkillTemplateRecord[]; boundary: string }>(path, {
    signal,
  });
}

export async function createCustomSkillTemplate(
  agentId: string,
  payload: Omit<SkillTemplateRecord, "id" | "createdAt" | "updatedAt" | "builtIn" | "agentId" | "scope"> & {
    scope?: "agent" | "shared";
  },
) {
  return apiRequest<{ template: SkillTemplateRecord; boundary: string }>(
    `/api/agents/${encodeURIComponent(agentId)}/skill-templates`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function updateCustomSkillTemplate(
  agentId: string,
  templateId: string,
  payload: Partial<
    Omit<SkillTemplateRecord, "createdAt" | "updatedAt" | "builtIn" | "agentId" | "scope"> & {
      scope: "agent" | "shared";
    }
  >,
) {
  return apiRequest<{ template: SkillTemplateRecord; boundary: string }>(
    `/api/agents/${encodeURIComponent(agentId)}/skill-templates/${encodeURIComponent(templateId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export async function deleteCustomSkillTemplate(agentId: string, templateId: string) {
  return apiRequest<{ ok: boolean; templateId: string; boundary: string }>(
    `/api/agents/${encodeURIComponent(agentId)}/skill-templates/${encodeURIComponent(templateId)}`,
    { method: "DELETE" },
  );
}

export async function saveSkillTemplateFromFlow(agentId: string, flowId: string, force = false) {
  return apiRequest<{ template: SkillTemplateRecord; updatedExisting: boolean; boundary: string }>(
    `/api/agents/${encodeURIComponent(agentId)}/skill-templates/from-flow/${encodeURIComponent(flowId)}`,
    { method: "POST", body: JSON.stringify({ force }) },
  );
}

export async function applySkillTemplateToStandingOrders(agentId: string, templateId: string) {
  return apiRequest<{
    standingOrders: StandingOrdersRecord;
    template: SkillTemplateRecord;
    applied: boolean;
    message: string;
    boundary: string;
  }>(
    `/api/agents/${encodeURIComponent(agentId)}/skill-templates/${encodeURIComponent(
      templateId,
    )}/apply-standing-orders`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function applySkillTemplateToHeartbeat(agentId: string, templateId: string) {
  return apiRequest<{
    heartbeat: AgentHeartbeatRecord;
    template: SkillTemplateRecord;
    applied: boolean;
    message: string;
    boundary: string;
  }>(
    `/api/agents/${encodeURIComponent(agentId)}/skill-templates/${encodeURIComponent(
      templateId,
    )}/apply-heartbeat`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}
