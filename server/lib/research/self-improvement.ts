import type {
  ResearchProjectRecord,
  ResearchQuestionRecord,
  ResearchSafetyPolicy,
} from "../../types.js";

export const SELF_IMPROVEMENT_TITLE = "AetherOps 자기개선";

export const SELF_IMPROVEMENT_OBJECTIVE = [
  "Improve the AetherOps codebase while preserving the product boundary:",
  "AetherOps remains the local-first cockpit, scheduler, memory, research ledger, approval UX, artifact/report/search store.",
  "opencode remains the only workspace execution engine.",
  "Make at most one coherent improvement per loop, validate it, and stop with a report.",
].join("\n");

export const SELF_IMPROVEMENT_QUESTION =
  "현재 AetherOps 코드베이스에서 가장 안전하고 영향도 높은 단일 개선은 무엇인가?";

interface SelfImprovementStore {
  listResearchProjects: (agentId?: string) => ResearchProjectRecord[];
  createResearchProject: (input: {
    agentId: string;
    conversationId?: string | null;
    title: string;
    objective: string;
    domain?: string | null;
    autonomyEnabled?: boolean;
    safetyPolicy?: Partial<ResearchSafetyPolicy>;
  }) => ResearchProjectRecord;
  updateResearchProject: (input: {
    projectId: string;
    status?: ResearchProjectRecord["status"];
    autonomyEnabled?: boolean;
    safetyPolicy?: Partial<ResearchSafetyPolicy>;
  }) => ResearchProjectRecord | null;
  listResearchQuestions: (projectId: string) => ResearchQuestionRecord[];
  createResearchQuestion: (input: {
    projectId: string;
    question: string;
    status?: ResearchQuestionRecord["status"];
    priority?: number;
  }) => ResearchQuestionRecord;
}

export function ensureSelfImprovementProject(input: {
  store: SelfImprovementStore;
  agentId: string;
  conversationId?: string | null;
  workspaceMode: "session" | "repository";
}) {
  const existing =
    input.store
      .listResearchProjects(input.agentId)
      .find((project) => project.domain === "self-improvement" && project.status !== "archived") ?? null;
  const safetyPolicy: Partial<ResearchSafetyPolicy> = {
    ...(existing?.safetyPolicy ?? {}),
    workspaceMode: input.workspaceMode,
  };
  const project = existing
    ? input.store.updateResearchProject({
        projectId: existing.id,
        status: "active",
        autonomyEnabled: true,
        safetyPolicy,
      }) ?? existing
    : input.store.createResearchProject({
        agentId: input.agentId,
        conversationId: input.conversationId ?? null,
        title: SELF_IMPROVEMENT_TITLE,
        objective: SELF_IMPROVEMENT_OBJECTIVE,
        domain: "self-improvement",
        autonomyEnabled: true,
        safetyPolicy,
      });
  const questions = input.store.listResearchQuestions(project.id);
  const question =
    questions.find((item) => item.question === SELF_IMPROVEMENT_QUESTION) ??
    input.store.createResearchQuestion({
      projectId: project.id,
      question: SELF_IMPROVEMENT_QUESTION,
      status: "open",
      priority: 90,
    });

  return { project, question };
}
