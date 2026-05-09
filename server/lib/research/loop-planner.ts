import type { ResearchProjectRecord } from "../../types.js";

export type ResearchFlowStepDraft = {
  stepKey: string;
  title: string;
  prompt: string;
  dependencyStepKey: string | null;
  stepKind: "task" | "approval_gate" | "verification_gate";
};

export function buildResearchLoopSteps(
  project: ResearchProjectRecord,
  question: string,
  goal: string,
): ResearchFlowStepDraft[] {
  const base: Array<Omit<ResearchFlowStepDraft, "dependencyStepKey">> = [
    {
      stepKey: "research-plan",
      title: "Research plan",
      prompt: [
        `Research objective: ${project.objective}`,
        `Focused question: ${question}`,
        `Loop goal: ${goal}`,
        "Produce a bounded research plan. Do not execute external or irreversible actions.",
      ].join("\n"),
      stepKind: "task",
    },
    {
      stepKey: "evidence-gathering",
      title: "Evidence gathering",
      prompt:
        "Inspect existing local reports, artifacts, summaries, and opencode-accessible project files. Gather evidence without fabricating citations.",
      stepKind: "task",
    },
    {
      stepKey: "hypothesis-update",
      title: "Hypothesis update",
      prompt: "Update hypotheses based on gathered evidence. Use sections: Claims, Evidence, Uncertainty, Next questions.",
      stepKind: "task",
    },
    {
      stepKey: "operator-approval",
      title: "Operator approval",
      prompt: "Human checkpoint before synthesis or any external/high-risk work.",
      stepKind: "approval_gate",
    },
    {
      stepKey: "synthesis",
      title: "Synthesis",
      prompt: "Synthesize findings into a concise research result. Keep uncertainty explicit.",
      stepKind: "task",
    },
    {
      stepKey: "verification",
      title: "Verification",
      prompt: "Verify claims against local evidence. List assumptions, gaps, and reproducibility notes.",
      stepKind: "verification_gate",
    },
    {
      stepKey: "next-actions",
      title: "Next actions",
      prompt: "Recommend the next bounded research loop or stop condition. Do not invent external source claims.",
      stepKind: "task",
    },
  ];
  return base.map((step, index) => ({
    ...step,
    dependencyStepKey: index === 0 ? null : base[index - 1].stepKey,
  }));
}
