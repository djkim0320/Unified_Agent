import type {
  ConversationRecord,
  MessageRecord,
  ResearchEvidenceRecord,
  ResearchHypothesisRecord,
  ProjectRagQueryResult,
  ResearchProjectRecord,
  ResearchProjectSessionRecord,
  ResearchQuestionRecord,
  ResearchSourceRecord,
  SessionSummaryRecord,
} from "../../types.js";

const MAX_CONTEXT_CHARS = 7_000;

function clip(text: string | null | undefined, maxLength: number) {
  const value = (text ?? "").trim();
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function tokenize(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2),
  );
}

function scoreText(queryTokens: Set<string>, text: string) {
  if (!queryTokens.size) return 0;
  const candidateTokens = tokenize(text);
  let score = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) score += 1;
  }
  return score;
}

function rankByQuery<T>(items: T[], queryTokens: Set<string>, textOf: (item: T) => string) {
  return [...items]
    .map((item, index) => ({ item, index, score: scoreText(queryTokens, textOf(item)) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.item);
}

function sourceLine(source: ResearchSourceRecord) {
  const details = [
    `title=${clip(source.title, 160)}`,
    source.url ? `url=${clip(source.url, 240)}` : null,
    source.author ? `author=${clip(source.author, 120)}` : null,
    source.institution ? `institution=${clip(source.institution, 120)}` : null,
    source.publishedAt ? `published=${clip(source.publishedAt, 80)}` : null,
    source.accessedAt ? `accessed=${clip(source.accessedAt, 80)}` : null,
    `reliability=${source.reliability.toFixed(2)}`,
    source.relatedClaim ? `claim=${clip(source.relatedClaim, 220)}` : null,
  ].filter(Boolean);
  return [
    `- ${details.join(" | ")}`,
    `  summary: ${clip(source.summary, 520)}`,
    source.quote ? `  quote: ${clip(source.quote, 360)}` : null,
    source.snapshot ? `  snapshot excerpt: ${clip(source.snapshot, 420)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function evidenceLine(evidence: ResearchEvidenceRecord) {
  return [
    `- claim=${clip(evidence.claim, 220)} | confidence=${evidence.confidence.toFixed(2)} | source=${evidence.sourceType}${evidence.sourceRef ? `:${evidence.sourceRef}` : ""}`,
    `  summary: ${clip(evidence.summary, 520)}`,
    evidence.uncertainty ? `  uncertainty: ${clip(evidence.uncertainty, 260)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function ragResultLine(result: ProjectRagQueryResult) {
  return [
    `- ${clip(result.document.title, 180)} | type=${result.document.sourceType} | reliability=${result.document.reliability.toFixed(2)} | confidence=${result.document.confidence.toFixed(2)} | score=${result.score.toFixed(2)}`,
    result.document.uri ? `  uri: ${clip(result.document.uri, 260)}` : null,
    `  snippet: ${clip(result.snippet, 620)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function sessionLine(session: {
  link: ResearchProjectSessionRecord;
  conversation: ConversationRecord | null;
  summary: SessionSummaryRecord | null;
  messages: Array<Pick<MessageRecord, "role" | "content">>;
}) {
  const title = session.conversation?.title ?? session.link.conversationId;
  const summaryText = session.summary
    ? [
        session.summary.summary,
        session.summary.decisions.length ? `Decisions: ${session.summary.decisions.join("; ")}` : "",
        session.summary.openQuestions.length ? `Open questions: ${session.summary.openQuestions.join("; ")}` : "",
        session.summary.nextActions.length ? `Next actions: ${session.summary.nextActions.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const recentMessages = session.messages
    .slice(-4)
    .map((message) => `${message.role}: ${clip(message.content, 420)}`)
    .join("\n");
  return [
    `- ${clip(title, 160)} | conversation=${session.link.conversationId} | role=${session.link.role}`,
    summaryText ? `  summary: ${clip(summaryText, 900)}` : null,
    recentMessages ? `  recent messages:\n${recentMessages}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildResearchRagContext(input: {
  project: ResearchProjectRecord;
  question?: ResearchQuestionRecord | null;
  goal?: string | null;
  hypotheses?: ResearchHypothesisRecord[];
  evidence: ResearchEvidenceRecord[];
  sources: ResearchSourceRecord[];
  ragResults?: ProjectRagQueryResult[];
  sessions?: Array<{
    link: ResearchProjectSessionRecord;
    conversation: ConversationRecord | null;
    summary: SessionSummaryRecord | null;
    messages: Array<Pick<MessageRecord, "role" | "content">>;
  }>;
  projectFiles?: Array<{
    path: string;
    content: string;
  }>;
}) {
  const query = [
    input.project.title,
    input.project.objective,
    input.question?.question ?? "",
    input.goal ?? "",
    ...(input.hypotheses ?? []).map((hypothesis) => hypothesis.hypothesis),
  ].join("\n");
  const queryTokens = tokenize(query);
  const rankedSources = rankByQuery(input.sources, queryTokens, (source) =>
    [
      source.title,
      source.url ?? "",
      source.author ?? "",
      source.institution ?? "",
      source.summary,
      source.quote ?? "",
      source.snapshot ?? "",
      source.relatedClaim ?? "",
    ].join("\n"),
  ).slice(0, 6);
  const rankedEvidence = rankByQuery(input.evidence, queryTokens, (evidence) =>
    [evidence.claim, evidence.summary, evidence.uncertainty ?? ""].join("\n"),
  ).slice(0, 6);
  const rankedSessions = rankByQuery(input.sessions ?? [], queryTokens, (session) =>
    [
      session.conversation?.title ?? "",
      session.summary?.summary ?? "",
      ...(session.summary?.decisions ?? []),
      ...(session.summary?.openQuestions ?? []),
      ...(session.summary?.nextActions ?? []),
      ...session.messages.slice(-8).map((message) => message.content),
    ].join("\n"),
  )
    .filter((session) => session.link.includeInContext)
    .slice(0, 5);
  const projectFiles = (input.projectFiles ?? []).slice(0, 4);
  const ragResults = (input.ragResults ?? []).slice(0, 6);

  const sections = [
    "Project research DB context:",
    "- Use the records below as local memory for this project.",
    "- Treat them as evidence candidates, not unquestionable truth.",
    "- When you use a source, mention the title/URL/reliability in your report.",
    "- If you inspect a useful source that should be remembered, include a `Sources to record:` section using the exact field names below.",
    "",
    "Source capture format:",
    "Sources to record:",
    "- title: <source title>",
    "  url: <https URL or blank>",
    "  author: <author if known>",
    "  institution: <institution if known>",
    "  published_at: <date if known>",
    "  summary: <short factual summary>",
    "  quote: <short supporting quote or passage>",
    "  related_claim: <claim this supports or challenges>",
    "  reliability: <0.0 to 1.0>",
    "  snapshot: <brief excerpt of the content read at the time>",
    "",
    rankedSessions.length ? "Linked project session memory:" : "Linked project session memory: none.",
    rankedSessions.map(sessionLine).join("\n"),
    "",
    projectFiles.length ? "Project workspace files:" : "Project workspace files: none.",
    projectFiles
      .map((file) => [`### ${file.path}`, clip(file.content, 1400)].join("\n"))
      .join("\n\n"),
    "",
    ragResults.length ? "Retrieved project RAG chunks:" : "Retrieved project RAG chunks: none yet.",
    ragResults.map(ragResultLine).join("\n"),
    "",
    rankedSources.length ? "Retrieved project sources:" : "Retrieved project sources: none yet.",
    rankedSources.map(sourceLine).join("\n"),
    "",
    rankedEvidence.length ? "Retrieved project evidence:" : "Retrieved project evidence: none yet.",
    rankedEvidence.map(evidenceLine).join("\n"),
  ].filter(Boolean);

  return clip(sections.join("\n"), MAX_CONTEXT_CHARS);
}
