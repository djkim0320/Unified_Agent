export interface ResearchSections {
  hypotheses: string[];
  claims: string[];
  evidence: string[];
  uncertainty: string | null;
  nextQuestions: string[];
}

export interface ParsedResearchSource {
  title: string;
  url: string | null;
  author: string | null;
  institution: string | null;
  publishedAt: string | null;
  accessedAt: string | null;
  summary: string;
  quote: string | null;
  snapshot: string | null;
  reliability: number | null;
  relatedClaim: string | null;
}

export function extractResearchSections(text: string): ResearchSections {
  const sections: Record<string, string[]> = {};
  let current: string | null = null;
  const aliases: Array<[RegExp, keyof ResearchSections]> = [
    [/^hypotheses?\s*:?\s*$/i, "hypotheses"],
    [/^claims?\s*:?\s*$/i, "claims"],
    [/^evidence\s*:?\s*$/i, "evidence"],
    [/^uncertainty|uncertainties\s*:?\s*$/i, "uncertainty"],
    [/^next questions?\s*:?\s*$/i, "nextQuestions"],
  ];

  for (const line of text.split(/\r?\n/)) {
    const normalized = line.replace(/^#+\s*/, "").trim();
    const match = aliases.find(([pattern]) => pattern.test(normalized));
    if (match) {
      current = match[1];
      sections[current] ??= [];
      continue;
    }
    if (current && normalized) {
      sections[current].push(normalized.replace(/^[-*\d.)\s]+/, "").trim());
    }
  }

  return {
    hypotheses: sections.hypotheses ?? [],
    claims: sections.claims ?? [],
    evidence: sections.evidence ?? [],
    uncertainty: sections.uncertainty?.join("\n") || null,
    nextQuestions: sections.nextQuestions ?? [],
  };
}

const sourceHeaderPattern = /^(sources?\s+to\s+record|source\s+records?|research\s+sources?|recorded\s+sources?|출처(?:\s*DB)?|기록할\s*출처)\s*:?\s*$/i;

function normalizeKey(key: string) {
  return key
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
}

function assignSourceField(target: Record<string, string>, rawKey: string, rawValue: string) {
  const key = normalizeKey(rawKey);
  const value = rawValue.trim();
  if (!value) return;
  if (["title", "제목"].includes(key)) target.title = value;
  else if (["url", "link", "링크"].includes(key)) target.url = value;
  else if (["author", "authors", "저자"].includes(key)) target.author = value;
  else if (["institution", "organization", "publisher", "기관", "발행기관"].includes(key)) target.institution = value;
  else if (["published", "published_at", "date", "발행일"].includes(key)) target.publishedAt = value;
  else if (["accessed", "accessed_at", "접근일"].includes(key)) target.accessedAt = value;
  else if (["summary", "요약"].includes(key)) target.summary = value;
  else if (["quote", "quotation", "citation", "인용문"].includes(key)) target.quote = value;
  else if (["snapshot", "content_snapshot", "본문_스냅샷", "스냅샷"].includes(key)) target.snapshot = value;
  else if (["reliability", "confidence", "trust", "신뢰도"].includes(key)) target.reliability = value;
  else if (["claim", "related_claim", "주장", "관련_주장"].includes(key)) target.relatedClaim = value;
}

function parseInlineSourceFields(line: string) {
  const fields: Record<string, string> = {};
  const matches = [...line.matchAll(/([A-Za-z가-힣_ -]{2,24})\s*:\s*([^|;]+)(?=$|[|;])/g)];
  for (const match of matches) {
    assignSourceField(fields, match[1], match[2]);
  }
  return fields;
}

export function extractResearchSources(text: string): ParsedResearchSource[] {
  const sources: Array<Record<string, string>> = [];
  let inSources = false;
  let current: Record<string, string> | null = null;

  const flush = () => {
    if (current && (current.title || current.url || current.summary)) {
      sources.push(current);
    }
    current = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const normalized = rawLine.replace(/^#+\s*/, "").trim();
    if (!normalized) continue;
    if (sourceHeaderPattern.test(normalized)) {
      inSources = true;
      flush();
      continue;
    }
    if (inSources && /^(hypotheses?|claims?|evidence|uncertainty|uncertainties|next questions?)\s*:?\s*$/i.test(normalized)) {
      flush();
      inSources = false;
      continue;
    }
    if (!inSources) continue;

    const bullet = normalized.match(/^[-*]\s+(.*)$/);
    const line = bullet?.[1] ?? normalized;
    const inlineFields = parseInlineSourceFields(line);
    if (bullet && Object.keys(inlineFields).length) {
      flush();
      current = inlineFields;
      continue;
    }
    if (bullet && !Object.keys(inlineFields).length) {
      flush();
      current = { title: line };
      continue;
    }
    const keyValue = line.match(/^([A-Za-z가-힣_ -]{2,24})\s*:\s*(.*)$/);
    if (keyValue) {
      current ??= {};
      assignSourceField(current, keyValue[1], keyValue[2]);
      continue;
    }
    if (current) {
      current.summary = current.summary ? `${current.summary}\n${line}` : line;
    }
  }
  flush();

  return sources
    .map((source) => {
      const reliability = source.reliability ? Number.parseFloat(source.reliability) : Number.NaN;
      return {
        title: source.title?.trim() || source.url?.trim() || "Untitled source",
        url: source.url?.trim() || null,
        author: source.author?.trim() || null,
        institution: source.institution?.trim() || null,
        publishedAt: source.publishedAt?.trim() || null,
        accessedAt: source.accessedAt?.trim() || null,
        summary: source.summary?.trim() || source.quote?.trim() || source.snapshot?.trim() || "Source captured by research loop.",
        quote: source.quote?.trim() || null,
        snapshot: source.snapshot?.trim() || null,
        reliability: Number.isFinite(reliability) ? Math.max(0, Math.min(1, reliability)) : null,
        relatedClaim: source.relatedClaim?.trim() || null,
      };
    })
    .filter((source) => source.title || source.url || source.summary)
    .slice(0, 12);
}
