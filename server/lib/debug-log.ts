import fs from "node:fs";
import path from "node:path";

export interface DebugLogEntry {
  timestamp: string;
  event: string;
  details: Record<string, unknown>;
}

function safeConsolePayload(details: Record<string, unknown>) {
  return JSON.stringify(details);
}

export function redactOpaqueValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  if (value.length <= 12) {
    return `[redacted:${value.length}]`;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)} [redacted:${value.length}]`;
}

export function createDebugLog(params: {
  dataDir: string;
  fileName: string;
  namespace: string;
}) {
  const logPath = path.join(params.dataDir, params.fileName);
  const entries: DebugLogEntry[] = [];

  const append = (event: string, details: Record<string, unknown>) => {
    const entry: DebugLogEntry = {
      timestamp: new Date().toISOString(),
      event,
      details,
    };

    entries.push(entry);
    if (entries.length > 200) {
      entries.shift();
    }

    try {
      fs.mkdirSync(params.dataDir, { recursive: true });
      fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      // Best-effort debug logging should not break app flows.
    }

    console.info(`[${params.namespace}] ${event} ${safeConsolePayload(details)}`);
    return entry;
  };

  const list = () => [...entries];
  const readText = () =>
    fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";

  return {
    append,
    list,
    readText,
    logPath,
  };
}
