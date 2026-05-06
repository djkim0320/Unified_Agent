import type {
  ArtifactRecord,
  ConversationRecord,
  TaskFlowRecord,
  TaskFlowStepRecord,
  TaskRecord,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
} from "../types.js";

export interface VerificationChecklistTemplate {
  id: string;
  title: string;
  items: string[];
}

export const VERIFICATION_CHECKLIST_TEMPLATES = [
  {
    id: "typescript-project",
    title: "TypeScript project",
    items: ["pnpm typecheck", "pnpm test", "pnpm build"],
  },
  {
    id: "code-review",
    title: "Code review",
    items: [
      "Changed files reviewed",
      "Tests updated",
      "No secrets logged",
      "No absolute paths leaked",
    ],
  },
  {
    id: "research",
    title: "Research",
    items: [
      "Assumptions listed",
      "Sources noted if available",
      "Uncertainty recorded",
    ],
  },
  {
    id: "aircraft-cfd",
    title: "Aircraft / CFD",
    items: [
      "Requirements captured",
      "Geometry assumptions captured",
      "CFD boundary conditions listed",
      "Validation plan listed",
    ],
  },
] as const satisfies VerificationChecklistTemplate[];

const MAX_REPORT_TEXT = 1600;
const MAX_EVENT_TEXT = 240;
const MAX_LIST_ITEMS = 12;

function redactSensitiveText(value: string) {
  return value
    .replace(/\b(?:sk|rk|pk|sess|ghp|gho|ghu|github_pat|xox[abprs])[-_A-Za-z0-9]{12,}\b/g, "[redacted secret]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, "Bearer [redacted]")
    .replace(/\b[A-Za-z]:[\\/][^\s'"<>]+/g, "[local path]")
    .replace(/\\\\[^\s'"<>]+/g, "[local path]")
    .replace(/\/(?:Users|home|var|tmp|mnt|Volumes)\/[^\s'"<>]+/g, "[local path]");
}

function clip(value: string | null | undefined, max = MAX_REPORT_TEXT) {
  const text = redactSensitiveText((value ?? "").trim());
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? clip(value, MAX_EVENT_TEXT) : null;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => clip(entry, 240));
}

function eventMessage(event: WorkspaceRunEventRecord) {
  const payload = event.payload;
  return (
    stringValue(payload.message) ??
    stringValue(payload.error) ??
    stringValue(payload.summary) ??
    stringValue(payload.reason) ??
    stringValue(payload.phase) ??
    event.eventType
  );
}

function importantEvents(events: WorkspaceRunEventRecord[]) {
  return events
    .filter((event) =>
      ["status", "error", "run_complete", "run_failed", "run_cancelled"].includes(event.eventType),
    )
    .slice(-MAX_LIST_ITEMS)
    .map((event) => `${event.eventType}: ${eventMessage(event)}`);
}

function uniqueChangedFiles(events: WorkspaceRunEventRecord[], fallback: string[] = []) {
  return [
    ...new Set([
      ...fallback,
      ...events.flatMap((event) => stringArray(event.payload.changedFiles)),
    ]),
  ].slice(0, MAX_LIST_ITEMS);
}

function latestPayloadString(events: WorkspaceRunEventRecord[], key: string) {
  return (
    [...events]
      .reverse()
      .map((event) => stringValue(event.payload[key]))
      .find(Boolean) ?? null
  );
}

function latestEngineRunPayload(events: WorkspaceRunEventRecord[]) {
  return (
    [...events]
      .reverse()
      .map((event) => event.payload.engineRun)
      .find((value): value is { eventSummary?: Record<string, unknown>; status?: string } =>
        typeof value === "object" && value !== null,
      ) ?? null
  );
}

function listMarkdown(items: string[], emptyText: string) {
  if (!items.length) {
    return `- ${emptyText}`;
  }
  return items.slice(0, MAX_LIST_ITEMS).map((item) => `- ${clip(item, 300)}`).join("\n");
}

function chooseChecklists(context: {
  requestText?: string | null;
  changedFiles: string[];
  artifactTitles: string[];
}) {
  const haystack = [
    context.requestText ?? "",
    ...context.changedFiles,
    ...context.artifactTitles,
  ]
    .join(" ")
    .toLowerCase();
  const selected = new Set<string>(["code-review"]);
  if (/\.(ts|tsx|js|jsx|json|css)\b|package\.json|pnpm|typecheck|vitest|vite/.test(haystack)) {
    selected.add("typescript-project");
  }
  if (/research|source|summary|조사|출처|요약|불확실/.test(haystack)) {
    selected.add("research");
  }
  if (/aircraft|항공|cfd|geometry|boundary|mesh|solver|aero/.test(haystack)) {
    selected.add("aircraft-cfd");
  }
  return VERIFICATION_CHECKLIST_TEMPLATES.filter((template) => selected.has(template.id));
}

function checklistMarkdown(templates: readonly VerificationChecklistTemplate[]) {
  return templates
    .map((template) => [`### ${template.title}`, ...template.items.map((item) => `- [ ] ${item}`)].join("\n"))
    .join("\n\n");
}

function artifactLines(artifacts: ArtifactRecord[]) {
  return artifacts
    .filter((artifact) => artifact.kind !== "report")
    .slice(0, MAX_LIST_ITEMS)
    .map((artifact) => `${artifact.kind}: ${artifact.path ?? artifact.title}`);
}

function nextActionForRun(status: WorkspaceRunRecord["status"], changedFiles: string[], error: string | null) {
  if (status === "completed") {
    return changedFiles.length
      ? "Review changed files and run the recommended verification checklist through an opencode-backed task."
      : "Review the assistant result and decide whether a follow-up task or flow is needed.";
  }
  if (status === "cancelled") {
    return "Resume the run only if the cancelled work is still desired.";
  }
  return error
    ? "Inspect the failure, adjust the prompt or environment, then resume with a continuation task."
    : "Open the run debugger and resume if the original request is still valid.";
}

export function buildRunReportArtifact(params: {
  run: WorkspaceRunRecord;
  conversation: ConversationRecord;
  task: TaskRecord | null;
  events: WorkspaceRunEventRecord[];
  artifacts: ArtifactRecord[];
}) {
  const changedFiles = uniqueChangedFiles(params.events, params.run.checkpoint?.changedFiles ?? []);
  const artifactSummaries = artifactLines(params.artifacts);
  const error = latestPayloadString(params.events, "error");
  const assistantSummary =
    latestPayloadString(params.events, "assistantSummary") ??
    (params.task?.status === "completed" ? clip(params.task.resultText, 800) : null) ??
    "No assistant result summary was captured.";
  const engineRun = latestEngineRunPayload(params.events);
  const stderrSummary =
    stringValue(engineRun?.eventSummary?.stderr) ??
    latestPayloadString(params.events, "stderrSummary");
  const checklistTemplates = chooseChecklists({
    requestText: params.run.userMessage,
    changedFiles,
    artifactTitles: params.artifacts.map((artifact) => artifact.title),
  });
  const nextRecommendedAction = nextActionForRun(params.run.status, changedFiles, error);
  const reportTitle = params.run.status === "completed" ? "Run Completion Report" : "Run Failure Report";
  const markdown = [
    `# ${reportTitle}`,
    "",
    `- Session: ${clip(params.conversation.title, 200)}`,
    `- Original request: ${clip(params.run.userMessage, 1000) || "(empty)"}`,
    `- Provider / model: ${params.run.providerKind} / ${params.run.model}`,
    `- Status: ${params.run.status}`,
    `- Last phase: ${params.run.phase}`,
    params.task ? `- Task: ${params.task.title} (${params.task.taskKind}, ${params.task.status})` : "- Task: none",
    "",
    "## Changed Files",
    listMarkdown(changedFiles, "No changed files were recorded."),
    "",
    "## Artifacts",
    listMarkdown(artifactSummaries, "No artifacts were recorded before the report."),
    "",
    "## Important Events",
    listMarkdown(importantEvents(params.events), "No important events were recorded."),
    "",
    "## Assistant Result Summary",
    assistantSummary,
    "",
    "## Failure Details",
    params.run.status === "completed"
      ? "- No failure was recorded."
      : listMarkdown(
          [
            error ? `Last error: ${error}` : "",
            stderrSummary ? `stderr summary: ${stderrSummary}` : "",
            `Retry / resume availability: ${params.run.status === "running" ? "not available while running" : "resume endpoint available"}`,
          ].filter(Boolean),
          "No error details were recorded.",
        ),
    "",
    "## Verification Checklist",
    checklistMarkdown(checklistTemplates),
    "",
    "## Next Recommended Action",
    nextRecommendedAction,
  ].join("\n");

  return {
    title: reportTitle,
    summary:
      params.run.status === "completed"
        ? `Completed run report for ${params.run.model}.`
        : `Failure report for ${params.run.status} run on ${params.run.model}.`,
    metadata: {
      reportType: "run",
      markdown,
      status: params.run.status,
      phase: params.run.phase,
      model: params.run.model,
      providerKind: params.run.providerKind,
      changedFiles,
      artifactIds: params.artifacts.map((artifact) => artifact.id),
      checklistTemplates,
      nextRecommendedAction,
      retryAvailable: params.run.status !== "running",
      resumeAvailable: params.run.status !== "running",
      generatedAt: Date.now(),
    },
  };
}

export function buildFlowReportArtifact(params: {
  flow: TaskFlowRecord;
  conversation: ConversationRecord;
  steps: Array<{
    step: TaskFlowStepRecord;
    task: TaskRecord | null;
    run: WorkspaceRunRecord | null;
    events: WorkspaceRunEventRecord[];
    artifacts: ArtifactRecord[];
  }>;
}) {
  const changedFiles = [
    ...new Set(params.steps.flatMap((step) => uniqueChangedFiles(step.events))),
  ].slice(0, MAX_LIST_ITEMS);
  const allArtifacts = params.steps.flatMap((step) => step.artifacts).filter((artifact) => artifact.kind !== "report");
  const unresolved = params.steps
    .filter((step) => !["completed", "skipped"].includes(step.step.status))
    .map((step) => `${step.step.title}: ${step.step.status}`);
  const checklistTemplates = chooseChecklists({
    requestText: `${params.flow.title} ${params.flow.resultSummary ?? ""}`,
    changedFiles,
    artifactTitles: allArtifacts.map((artifact) => artifact.title),
  });
  const stepLines = params.steps.map(({ step, task, run, events, artifacts }) => {
    const output =
      task?.resultText ??
      latestPayloadString(events, "assistantSummary") ??
      latestPayloadString(events, "summary") ??
      latestPayloadString(events, "message") ??
      "No output summary recorded.";
    return [
      `### ${step.title}`,
      `- Step key: ${step.stepKey}`,
      `- Status: ${step.status}`,
      `- Dependency: ${step.dependencyStepKey ?? "none"}`,
      `- Task: ${task ? `${task.id} (${task.status})` : "none"}`,
      `- Run: ${run ? `${run.id} (${run.status}/${run.phase})` : "none"}`,
      `- Artifacts: ${artifacts.filter((artifact) => artifact.kind !== "report").length}`,
      `- Output: ${clip(output, 600)}`,
    ].join("\n");
  });
  const recommendedPrompt = unresolved.length
    ? `Resolve unresolved flow items: ${unresolved.join("; ")}`
    : `Review the flow report for "${params.flow.title}" and create the next implementation or verification flow.`;
  const markdown = [
    "# Flow Completion Report",
    "",
    `- Flow: ${clip(params.flow.title, 240)}`,
    `- Session: ${clip(params.conversation.title, 200)}`,
    `- Status: ${params.flow.status}`,
    `- Steps: ${params.steps.length}`,
    "",
    "## Step Results",
    stepLines.join("\n\n") || "- No steps were recorded.",
    "",
    "## Final Summary",
    clip(params.flow.resultSummary, 1200) || "No final summary was recorded.",
    "",
    "## Artifacts",
    listMarkdown(artifactLines(allArtifacts), "No artifacts were recorded."),
    "",
    "## Unresolved Issues",
    listMarkdown(unresolved, "No unresolved issues were recorded."),
    "",
    "## Verification Checklist",
    checklistMarkdown(checklistTemplates),
    "",
    "## Recommended Next Flow Or Chat Prompt",
    recommendedPrompt,
  ].join("\n");

  return {
    title: `Flow Report: ${params.flow.title}`,
    summary: `Completion report for flow "${params.flow.title}".`,
    metadata: {
      reportType: "flow",
      flowId: params.flow.id,
      markdown,
      status: params.flow.status,
      changedFiles,
      artifactIds: allArtifacts.map((artifact) => artifact.id),
      checklistTemplates,
      unresolvedIssues: unresolved,
      nextRecommendedAction: recommendedPrompt,
      generatedAt: Date.now(),
    },
  };
}
