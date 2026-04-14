const DEFAULT_HEARTBEAT_ENABLED = false;
const DEFAULT_HEARTBEAT_INTERVAL_MINUTES = 60;

export interface ParsedHeartbeatDocument {
  enabled: boolean;
  intervalMinutes: number;
  lastRun: string | null;
  instructions: string;
  parseError: string | null;
}

export interface HeartbeatDocumentInput {
  enabled: boolean;
  intervalMinutes: number;
  lastRun: string | null;
  instructions: string;
}

function normalizeLineEndings(content: string) {
  return content.replace(/\r\n/g, "\n");
}

function stripQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseBoolean(value: string) {
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "off", "0"].includes(normalized)) {
    return false;
  }
  return null;
}

function parseIntervalMinutes(value: string) {
  const normalized = Number.parseInt(value.trim(), 10);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

function parseHeartbeatField(line: string) {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }
  return {
    key: line.slice(0, separatorIndex).trim().toLowerCase(),
    value: stripQuotes(line.slice(separatorIndex + 1).trim()),
  };
}

export function parseHeartbeatDocument(content: string): ParsedHeartbeatDocument {
  const source = normalizeLineEndings(content.replace(/^\uFEFF/, ""));
  if (!source.startsWith("---\n")) {
    return {
      enabled: DEFAULT_HEARTBEAT_ENABLED,
      intervalMinutes: DEFAULT_HEARTBEAT_INTERVAL_MINUTES,
      lastRun: null,
      instructions: source,
      parseError: null,
    };
  }

  const closingMarker = "\n---\n";
  const closingIndex = source.indexOf(closingMarker, 4);
  if (closingIndex === -1) {
    return {
      enabled: DEFAULT_HEARTBEAT_ENABLED,
      intervalMinutes: DEFAULT_HEARTBEAT_INTERVAL_MINUTES,
      lastRun: null,
      instructions: source,
      parseError: "Missing closing frontmatter delimiter.",
    };
  }

  const frontmatter = source.slice(4, closingIndex);
  const instructions = source.slice(closingIndex + closingMarker.length).replace(/^\n/, "");
  const errors: string[] = [];
  let enabled = DEFAULT_HEARTBEAT_ENABLED;
  let intervalMinutes = DEFAULT_HEARTBEAT_INTERVAL_MINUTES;
  let lastRun: string | null = null;

  for (const rawLine of frontmatter.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const parsed = parseHeartbeatField(line);
    if (!parsed) {
      errors.push(`Invalid heartbeat field: ${line}`);
      continue;
    }

    if (parsed.key === "enabled") {
      const value = parseBoolean(parsed.value);
      if (value === null) {
        errors.push(`Invalid enabled value: ${parsed.value}`);
      } else {
        enabled = value;
      }
      continue;
    }

    if (parsed.key === "interval_minutes") {
      const value = parseIntervalMinutes(parsed.value);
      if (value === null) {
        errors.push(`Invalid interval_minutes value: ${parsed.value}`);
      } else {
        intervalMinutes = value;
      }
      continue;
    }

    if (parsed.key === "last_run") {
      lastRun = parsed.value && parsed.value.toLowerCase() !== "null" ? parsed.value : null;
      continue;
    }
  }

  return {
    enabled,
    intervalMinutes,
    lastRun,
    instructions,
    parseError: errors.length ? errors.join("; ") : null,
  };
}

export function serializeHeartbeatDocument(input: HeartbeatDocumentInput) {
  const body = normalizeLineEndings(input.instructions);
  return [
    "---",
    `enabled: ${input.enabled ? "true" : "false"}`,
    `interval_minutes: ${Math.max(1, Math.trunc(input.intervalMinutes))}`,
    `last_run: ${input.lastRun ?? "null"}`,
    "---",
    "",
    body,
  ].join("\n");
}
