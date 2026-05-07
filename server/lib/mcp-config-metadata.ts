import fs from "node:fs";
import path from "node:path";
import type {
  EngineStatusRecord,
  McpConfigStatus,
  McpSnippetValidationResult,
  McpRiskLevel,
  McpServerCategory,
  McpServerSummary,
} from "../types.js";

const MCP_CATALOG: McpServerSummary[] = [
  {
    id: "filesystem",
    name: "Filesystem",
    category: "filesystem",
    status: "candidate",
    riskLevel: "high",
    permissions: ["workspace file read", "workspace file write if server allows it"],
    description: "세션 sandbox 또는 사용자가 지정한 안전 경계 안에서 파일을 읽고 수정할 수 있게 합니다.",
    recommendedBoundary: "AetherOps session sandbox처럼 좁은 디렉터리만 허용하세요.",
    warnings: [
      "넓은 루트 디렉터리를 허용하면 의도치 않은 파일 읽기/수정 위험이 큽니다.",
      "쓰기 권한이 있는 파일 서버는 신뢰한 작업에서만 사용하세요.",
    ],
    testPrompt:
      "Check whether the configured Filesystem MCP capability is available inside the current session sandbox. Do not modify files. Summarize what tools are available.",
    configSnippet: JSON.stringify(
      {
        mcp: {
          filesystem: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "<safe-session-sandbox-path>"],
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: "browser",
    name: "Browser / Web",
    category: "browser",
    status: "candidate",
    riskLevel: "high",
    permissions: ["web navigation", "page interaction", "possible authenticated state"],
    description: "opencode가 웹 페이지를 관찰하거나 브라우저 자동화 도구를 사용할 수 있게 합니다.",
    recommendedBoundary: "localhost 또는 명시 allowlist 도메인부터 시작하고 인증/제출 작업은 승인 정책을 두세요.",
    warnings: [
      "외부 웹 콘텐츠는 신뢰할 수 없는 입력입니다.",
      "로그인, 결제, 제출, 삭제성 클릭은 opencode/MCP 쪽 승인 정책을 요구하세요.",
    ],
    testPrompt:
      "Check whether the configured Browser MCP capability is available. Navigate only to localhost or 127.0.0.1 if needed. Do not submit forms or authenticate. Summarize available browser tools.",
    configSnippet: JSON.stringify(
      {
        mcp: {
          browser: {
            type: "stdio",
            command: "npx",
            args: ["-y", "<browser-mcp-server-package>", "--allowlist", "localhost,127.0.0.1"],
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: "github",
    name: "GitHub",
    category: "github",
    status: "candidate",
    riskLevel: "medium",
    permissions: ["repository read", "issues and pull requests", "optional repository write"],
    description: "이슈, PR, 코드 검색 같은 GitHub 작업을 opencode MCP 설정으로 노출합니다.",
    recommendedBoundary: "처음에는 read-only token과 특정 repository allowlist로 제한하세요.",
    warnings: [
      "쓰기 토큰은 PR/이슈 변경이나 repository mutation을 가능하게 할 수 있습니다.",
      "토큰 값은 AetherOps UI나 로그에 붙여 넣지 마세요.",
    ],
    testPrompt:
      "Check whether the configured GitHub MCP capability is available. Do not create, edit, close, or delete issues or pull requests. Summarize available read-only tools.",
    configSnippet: JSON.stringify(
      {
        mcp: {
          github: {
            type: "stdio",
            command: "npx",
            args: ["-y", "<github-mcp-server-package>"],
            env: {
              GITHUB_TOKEN: "{env:GITHUB_TOKEN}",
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: "database",
    name: "Database",
    category: "database",
    status: "candidate",
    riskLevel: "high",
    permissions: ["database schema read", "query execution", "possible mutation if configured"],
    description: "DB schema inspection과 제한된 쿼리 실행을 opencode MCP 설정으로 연결합니다.",
    recommendedBoundary: "read-only DB 계정, query timeout, production DB 금지 원칙을 먼저 적용하세요.",
    warnings: [
      "쓰기 권한 DB 계정은 데이터 손상 위험이 큽니다.",
      "운영 DB에는 연결하지 말고 로컬/복제/샘플 DB부터 사용하세요.",
    ],
    testPrompt:
      "Check whether the configured Database MCP capability is available. Do not run write queries. Summarize schemas or read-only tools only if exposed.",
    configSnippet: JSON.stringify(
      {
        mcp: {
          database: {
            type: "stdio",
            command: "<database-mcp-server>",
            args: ["--read-only"],
            env: {
              DATABASE_URL: "{env:DATABASE_URL}",
            },
          },
        },
      },
      null,
      2,
    ),
  },
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripJsonComments(content: string) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function detectParserType(content: string | undefined): "json" | "jsonc" | "unsupported" | "not-found" {
  if (!content?.trim()) {
    return "not-found";
  }
  try {
    JSON.parse(content);
    return "json";
  } catch {
    try {
      JSON.parse(stripJsonComments(content));
      return "jsonc";
    } catch {
      return "unsupported";
    }
  }
}

function parseMcpObject(content: string | undefined, warnings: string[]) {
  if (!content?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(stripJsonComments(content));
    if (!isObject(parsed.mcp)) {
      return null;
    }
    return parsed.mcp;
  } catch {
    warnings.push("opencode JSON config를 안전하게 파싱하지 못했습니다. TOML 또는 복잡한 형식은 UI에서 메타데이터로만 안내합니다.");
    return null;
  }
}

function readConfiguredMcpFromEnvOrConfig(configDir: string | null, warnings: string[]) {
  const fromEnv = parseMcpObject(process.env.OPENCODE_CONFIG_CONTENT, warnings);
  if (fromEnv) {
    return {
      source: "OPENCODE_CONFIG_CONTENT",
      mcp: fromEnv,
      parserType: detectParserType(process.env.OPENCODE_CONFIG_CONTENT),
      canWriteSafely: false,
    };
  }

  if (!configDir) {
    return { source: null, mcp: null, parserType: "not-found" as const, canWriteSafely: false };
  }

  for (const fileName of ["opencode.json", "opencode.jsonc", "config.json"]) {
    const candidate = path.join(configDir, fileName);
    try {
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
        continue;
      }
      const content = fs.readFileSync(candidate, "utf8");
      const mcp = parseMcpObject(content, warnings);
      if (mcp) {
        return {
          source: fileName,
          mcp,
          parserType: detectParserType(content),
          canWriteSafely: fileName.endsWith(".json") || fileName.endsWith(".jsonc"),
        };
      }
    } catch {
      warnings.push(`${fileName} 파일을 읽지 못했습니다. 권한 또는 파일 상태를 확인하세요.`);
    }
  }

  return { source: null, mcp: null, parserType: "not-found" as const, canWriteSafely: false };
}

function inferCategory(name: string, value: unknown): McpServerCategory {
  const haystack = `${name} ${JSON.stringify(value ?? {})}`.toLowerCase();
  if (haystack.includes("file") || haystack.includes("filesystem") || haystack.includes("fs")) {
    return "filesystem";
  }
  if (haystack.includes("browser") || haystack.includes("playwright") || haystack.includes("web")) {
    return "browser";
  }
  if (haystack.includes("github") || haystack.includes("git")) {
    return "github";
  }
  if (
    haystack.includes("database") ||
    haystack.includes("postgres") ||
    haystack.includes("sqlite") ||
    haystack.includes("mysql")
  ) {
    return "database";
  }
  return "custom";
}

function riskForCategory(category: McpServerCategory): McpRiskLevel {
  if (category === "github" || category === "custom") {
    return "medium";
  }
  return "high";
}

function permissionsForCategory(category: McpServerCategory) {
  switch (category) {
    case "filesystem":
      return ["file read/write depending on server config"];
    case "browser":
      return ["web navigation", "page interaction"];
    case "github":
      return ["repository and issue access depending on token scope"];
    case "database":
      return ["database query access depending on account permissions"];
    default:
      return ["custom external capability"];
  }
}

function configuredServerSummary(name: string, value: unknown, source: string | null): McpServerSummary {
  const category = inferCategory(name, value);
  const catalog = MCP_CATALOG.find((entry) => entry.category === category);
  return {
    id: name,
    name,
    category,
    status: "configured",
    riskLevel: riskForCategory(category),
    permissions: permissionsForCategory(category),
    description: catalog?.description ?? "opencode config에 등록된 custom MCP 서버입니다.",
    configSnippet: JSON.stringify({ mcp: { [name]: value ?? {} } }, null, 2),
    warnings: [
      ...(catalog?.warnings ?? ["custom MCP 서버는 권한과 입력 경계를 직접 검토해야 합니다."]),
      source ? `감지 출처: ${source}` : "정확한 config 출처를 확인하지 못했습니다.",
    ],
    recommendedBoundary: catalog?.recommendedBoundary ?? "최소 권한과 명시적인 allowlist를 적용하세요.",
    testPrompt:
      catalog?.testPrompt ??
      `Check whether the configured ${name} MCP capability is available. Do not perform writes, submissions, uploads, purchases, or deletes. Summarize available tools.`,
  };
}

export function getStaticMcpCatalog() {
  return MCP_CATALOG.map((entry) => ({
    ...entry,
    warnings: [...entry.warnings],
    permissions: [...entry.permissions],
  }));
}

export function getMcpCatalogEntry(id: string) {
  return getStaticMcpCatalog().find((entry) => entry.id === id) ?? null;
}

export function buildMcpConfigStatus(params: {
  engineStatus: EngineStatusRecord;
  exposeDebugPaths?: boolean;
}): McpConfigStatus {
  const warnings: string[] = [];
  const configDir = params.engineStatus.configDir;
  const configDirSource = !params.engineStatus.installed ? "unavailable" : configDir ? "env" : "default";
  const displayPath =
    configDirSource === "env"
      ? params.exposeDebugPaths
        ? configDir ?? "OPENCODE_CONFIG_DIR"
        : "[로컬 opencode 설정 경로 숨김]"
      : configDirSource === "default"
        ? "opencode 기본 설정 경로"
        : "opencode 상태 확인 필요";
  const { source, mcp, parserType, canWriteSafely } = readConfiguredMcpFromEnvOrConfig(configDir, warnings);
  const configuredServers = isObject(mcp)
    ? Object.entries(mcp).map(([name, value]) => configuredServerSummary(name, value, source))
    : [];

  if (!configuredServers.length) {
    warnings.push("현재 AetherOps가 안전하게 감지한 MCP 서버가 없습니다. catalog snippet을 복사해 opencode 설정에 추가하세요.");
  }

  return {
    engineAvailable: params.engineStatus.available,
    configDirSource,
    displayPath,
    ...(params.exposeDebugPaths ? { debugPath: configDir } : {}),
    parserType,
    sourceLabel: source ?? "not-found",
    canWriteSafely,
    validationWarnings: [...warnings],
    configuredCount: configuredServers.length,
    configuredServers,
    warnings,
  };
}

function containsLiteralSecret(value: string) {
  return (
    /\b(?:sk|rk|ghp|gho|github_pat|xox[abprs])[-_A-Za-z0-9]{12,}\b/.test(value) ||
    /\b[A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)[A-Z0-9_]*\s*:\s*["'][^"{][^"']{8,}["']/i.test(value)
  );
}

function envPlaceholdersFromSnippet(snippet: string) {
  return [
    ...new Set([
      ...Array.from(snippet.matchAll(/\{env:([A-Z0-9_]+)\}/gi)).map((match) => match[1]),
      ...Array.from(snippet.matchAll(/\$\{([A-Z0-9_]+)\}/g)).map((match) => match[1]),
      ...Array.from(snippet.matchAll(/\$([A-Z0-9_]+)/g)).map((match) => match[1]),
    ]),
  ].sort();
}

export function validateMcpSnippet(snippet: string): McpSnippetValidationResult {
  const trimmed = snippet.trim();
  const parserType = detectParserType(trimmed);
  const errors: string[] = [];
  const riskWarnings: string[] = [];
  const warnings: string[] = [];
  if (!trimmed) {
    return {
      ok: false,
      parserType: "unsupported",
      parsedServerCount: 0,
      riskWarnings: [],
      envPlaceholders: [],
      errors: ["스니펫이 비어 있습니다."],
      configuredServers: [],
    };
  }
  if (containsLiteralSecret(trimmed)) {
    errors.push("스니펫에 토큰처럼 보이는 literal secret이 포함되어 있습니다. {env:NAME} placeholder로 바꾸세요.");
  }
  if (parserType === "unsupported" || parserType === "not-found") {
    errors.push("JSON 또는 JSONC 형식의 opencode MCP 스니펫만 검증할 수 있습니다.");
  }
  const mcp = parseMcpObject(trimmed, warnings);
  if (!mcp || !isObject(mcp)) {
    errors.push("mcp 객체를 찾을 수 없습니다.");
  }
  const configuredServers = isObject(mcp)
    ? Object.entries(mcp).map(([name, value]) => configuredServerSummary(name, value, "snippet"))
    : [];
  for (const server of configuredServers) {
    if (server.riskLevel === "high") {
      riskWarnings.push(`${server.name}: ${server.recommendedBoundary ?? "고위험 MCP 서버는 명시적 경계가 필요합니다."}`);
    }
    riskWarnings.push(...server.warnings.slice(0, 2));
  }
  return {
    ok: errors.length === 0,
    parserType: parserType === "not-found" ? "unsupported" : parserType,
    parsedServerCount: configuredServers.length,
    riskWarnings: [...new Set([...riskWarnings, ...warnings])],
    envPlaceholders: envPlaceholdersFromSnippet(trimmed),
    errors,
    configuredServers,
  };
}
