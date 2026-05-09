import type { AppStore } from "../../routes/context.js";
import type { ResearchLoopRecord, ResearchProjectRecord } from "../../types.js";

export function buildResearchReportMarkdown(input: {
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
    `- Hypotheses tracked: ${hypotheses.length}`,
    `- Evidence records tracked: ${evidence.length}`,
    `- Research loops tracked: ${loops.length}`,
    "",
    "## Next experiments",
    questions.filter((item) => item.status === "open" || item.status === "investigating").length
      ? questions
          .filter((item) => item.status === "open" || item.status === "investigating")
          .map((item) => `- ${item.question}`)
          .join("\n")
      : "- No open questions remain.",
    "",
    "## Appendix: linked loops",
    loops.map((loop) => `- Loop ${loop.id}: ${loop.status}, flow=${loop.proposedFlowId ?? "-"}`).join("\n") ||
      "- No loops linked.",
  ].join("\n");
}
