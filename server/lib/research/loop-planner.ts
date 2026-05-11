import type { ResearchProjectRecord } from "../../types.js";

export type ResearchFlowStepDraft = {
  stepKey: string;
  title: string;
  prompt: string;
  dependencyStepKey: string | null;
  stepKind: "task" | "approval_gate" | "verification_gate";
};

function buildSelfImprovementSteps(
  project: ResearchProjectRecord,
  question: string,
  goal: string,
): ResearchFlowStepDraft[] {
  const base: Array<Omit<ResearchFlowStepDraft, "dependencyStepKey">> = [
    {
      stepKey: "hypothesis-plan",
      title: "Hypothesis plan",
      prompt: [
        `Research objective: ${project.objective}`,
        `Focused question: ${question}`,
        `Loop goal: ${goal}`,
        "",
        "Inspect the AetherOps repository and propose 2-3 testable improvement hypotheses.",
        "Choose exactly one hypothesis for this loop and explain why it is the safest/highest-impact candidate.",
        "Produce a short implementation plan with target files, expected benefit, risk level, and tests to run.",
        "Use sections: Hypotheses, Claims, Evidence, Uncertainty, Next questions.",
        "Do not edit source files in this step. Stop and make the plan reviewable.",
      ].join("\n"),
      stepKind: "task",
    },
    {
      stepKey: "operator-approval",
      title: "Operator approval",
      prompt: "Human checkpoint before repository edits. Continue only after the operator approves the plan.",
      stepKind: "approval_gate",
    },
    {
      stepKey: "implement-one-change",
      title: "Implement one change",
      prompt: [
        "Implement the approved single coherent improvement inside the repository workspace as an experiment for the selected hypothesis.",
        "Modify at most 8 source files unless the operator explicitly approved more.",
        "Do not weaken auth, redaction, export guards, workspace boundaries, MCP/Skill runtime boundaries, or approval gates.",
        "Do not add dependencies unless explicitly approved.",
      ].join("\n"),
      stepKind: "task",
    },
    {
      stepKey: "validate",
      title: "Validate",
      prompt: [
        "Validate whether the selected hypothesis improved the codebase without violating product boundaries.",
        "Run validation inside the repository workspace:",
        "- npm run typecheck",
        "- npm test",
        "- npm run build",
        "If validation fails, attempt one focused fix only. If it still fails, stop and report the exact failure.",
      ].join("\n"),
      stepKind: "task",
    },
    {
      stepKey: "final-report",
      title: "Final report",
      prompt: [
        "Generate a final report with summary, files changed, safety boundary review, validation results, remaining risks, and the next recommended loop.",
        "Create evidence-style sections: Hypotheses, Claims, Evidence, Uncertainty, Next questions.",
      ].join("\n"),
      stepKind: "task",
    },
  ];
  return base.map((step, index) => ({
    ...step,
    dependencyStepKey: index === 0 ? null : base[index - 1].stepKey,
  }));
}

export function buildResearchLoopSteps(
  project: ResearchProjectRecord,
  question: string,
  goal: string,
  researchContext?: string | null,
): ResearchFlowStepDraft[] {
  if (project.domain === "self-improvement") {
    return buildSelfImprovementSteps(project, question, goal);
  }

  const contextBlock = researchContext?.trim()
    ? ["", "Use this retrieved project DB context before planning or making claims:", researchContext.trim(), ""].join("\n")
    : "";

  const base: Array<Omit<ResearchFlowStepDraft, "dependencyStepKey">> = [
    {
      stepKey: "research-plan",
      title: "Research plan",
      prompt: [
        `Research objective: ${project.objective}`,
        `Focused question: ${question}`,
        `Loop goal: ${goal}`,
        contextBlock,
        "Produce a bounded research plan. Do not execute external or irreversible actions.",
      ].join("\n"),
      stepKind: "task",
    },
    {
      stepKey: "evidence-gathering",
      title: "Evidence gathering",
      prompt: [
        "Inspect existing local reports, artifacts, summaries, retrieved project DB context, and opencode-accessible project files.",
        "Gather evidence without fabricating citations.",
        "If a URL, paper, report, webpage, or document should be remembered by AetherOps, include it under `Sources to record:` with title, url, author/institution, published_at, summary, quote, related_claim, reliability, and snapshot.",
        contextBlock,
      ].join("\n"),
      stepKind: "task",
    },
    {
      stepKey: "hypothesis-update",
      title: "Hypothesis update",
      prompt: [
        "Update hypotheses based on gathered evidence and retrieved project DB context.",
        "Use sections: Claims, Evidence, Uncertainty, Next questions.",
        "When a claim depends on a stored source, name that source and reliability score.",
        contextBlock,
      ].join("\n"),
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
      prompt: [
        "Synthesize findings into a concise research result. Keep uncertainty explicit.",
        "Cite stored source titles/URLs/reliability where they support a conclusion.",
        contextBlock,
      ].join("\n"),
      stepKind: "task",
    },
    {
      stepKey: "verification",
      title: "Verification",
      prompt: [
        "Verify claims against local evidence and stored project sources.",
        "List assumptions, gaps, reproducibility notes, and any source reliability concerns.",
        contextBlock,
      ].join("\n"),
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
