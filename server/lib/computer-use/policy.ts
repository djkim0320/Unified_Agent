import net from "node:net";
import type {
  ComputerUseActionType,
  ComputerUseDecision,
  ComputerUseSettingsRecord,
  ToolRiskLevel,
} from "../../types.js";

export type TypedTextKind =
  | "plain"
  | "password"
  | "token"
  | "api_key"
  | "payment"
  | "email"
  | "personal";

export interface ComputerUsePolicyInput {
  actionType: ComputerUseActionType;
  targetUrl?: string | null;
  currentUrl?: string | null;
  selector?: string | null;
  visibleText?: string | null;
  typedTextKind?: TypedTextKind;
  submit?: boolean;
  authenticated?: boolean;
  maySubmit?: boolean;
  mayChangeState?: boolean;
  mayDelete?: boolean;
  mayUpload?: boolean;
  mayDownload?: boolean;
  mayPurchase?: boolean;
  settings: Pick<
    ComputerUseSettingsRecord,
    "enabled" | "allowExternalDomains" | "allowFileUrls"
  >;
}

export interface ComputerUsePolicyDecision {
  decision: ComputerUseDecision;
  risk: ToolRiskLevel;
  reasons: string[];
}

const DESTRUCTIVE_WORDS = [
  "delete",
  "remove",
  "reset",
  "publish",
  "send",
  "purchase",
  "buy",
  "checkout",
  "confirm",
  "transfer",
  "submit",
  "upload",
  "download",
  "logout",
  "결제",
  "삭제",
  "제거",
  "초기화",
  "게시",
  "전송",
  "구매",
  "확인",
  "송금",
  "제출",
  "업로드",
  "다운로드",
];

const METADATA_HOSTS = new Set([
  "metadata",
  "metadata.google.internal",
  "169.254.169.254",
  "100.100.100.200",
]);

function normalizeHostname(value: string) {
  return value.replace(/^\[(.*)\]$/, "$1").toLowerCase();
}

export function isLocalBrowserHost(hostname: string) {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function parseIpv4(address: string) {
  return address.split(".").map((segment) => Number.parseInt(segment, 10));
}

function isPrivateIpv4(address: string) {
  const [a, b] = parseIpv4(address);
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isSuspiciousInternalHost(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (METADATA_HOSTS.has(normalized)) {
    return true;
  }

  const family = net.isIP(normalized);
  if (family === 4) {
    return isPrivateIpv4(normalized) && !isLocalBrowserHost(normalized);
  }
  if (family === 6) {
    const lower = normalized.toLowerCase();
    return (
      !isLocalBrowserHost(lower) &&
      (lower.startsWith("fe8") ||
        lower.startsWith("fe9") ||
        lower.startsWith("fea") ||
        lower.startsWith("feb") ||
        lower.startsWith("fc") ||
        lower.startsWith("fd"))
    );
  }
  return normalized.endsWith(".internal") || normalized.endsWith(".local");
}

function safeParseUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeAllowedDomains(domains: string[]) {
  return domains
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function domainAllowed(hostname: string, allowlist: string[]) {
  const normalized = normalizeHostname(hostname);
  return allowlist.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

function textLooksDestructive(...values: Array<string | null | undefined>) {
  const haystack = values
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  return DESTRUCTIVE_WORDS.some((word) => haystack.includes(word.toLowerCase()));
}

function maxDecision(
  current: ComputerUsePolicyDecision,
  next: ComputerUsePolicyDecision,
): ComputerUsePolicyDecision {
  const rank: Record<ComputerUseDecision, number> = {
    allowed: 0,
    requires_approval: 1,
    blocked: 2,
  };
  return rank[next.decision] > rank[current.decision]
    ? { ...next, reasons: [...current.reasons, ...next.reasons] }
    : { ...current, reasons: [...current.reasons, ...next.reasons] };
}

function decision(
  value: ComputerUseDecision,
  risk: ToolRiskLevel,
  reason: string,
): ComputerUsePolicyDecision {
  return { decision: value, risk, reasons: [reason] };
}

export function evaluateComputerUsePolicy(
  input: ComputerUsePolicyInput,
): ComputerUsePolicyDecision {
  if (!input.settings.enabled) {
    return decision("blocked", "high", "Computer Use is disabled.");
  }

  let result = decision("allowed", "low", "Action is within the default local policy.");
  const targetUrl = safeParseUrl(input.targetUrl ?? input.currentUrl ?? null);
  const currentUrl = safeParseUrl(input.currentUrl ?? null);
  const url = targetUrl ?? currentUrl;

  if (url) {
    if (url.protocol === "file:") {
      result = maxDecision(
        result,
        input.settings.allowFileUrls
          ? decision("requires_approval", "high", "file:// navigation requires explicit approval.")
          : decision("blocked", "high", "file:// pages are disabled by default."),
      );
    } else if (!["http:", "https:", "about:"].includes(url.protocol)) {
      result = maxDecision(
        result,
        decision("blocked", "high", `Unsupported browser URL scheme: ${url.protocol}`),
      );
    }

    if (url.protocol === "http:" || url.protocol === "https:") {
      const hostname = normalizeHostname(url.hostname);
      const isLocal = isLocalBrowserHost(hostname);
      const allowlist = normalizeAllowedDomains(input.settings.allowExternalDomains);
      if (isSuspiciousInternalHost(hostname)) {
        result = maxDecision(
          result,
          decision("blocked", "high", `Blocked private or metadata host: ${hostname}`),
        );
      } else if (!isLocal && !domainAllowed(hostname, allowlist)) {
        result = maxDecision(
          result,
          decision("blocked", "high", `External domain is not allowlisted: ${hostname}`),
        );
      } else if (!isLocal && input.actionType === "navigate") {
        result = maxDecision(
          result,
          decision("requires_approval", "medium", `External navigation requires approval: ${hostname}`),
        );
      }
    }
  } else if (input.actionType === "navigate") {
    result = maxDecision(result, decision("blocked", "high", "Navigation URL could not be parsed."));
  }

  if (
    input.typedTextKind &&
    input.typedTextKind !== "plain" &&
    input.actionType === "type"
  ) {
    result = maxDecision(
      result,
      decision("requires_approval", "high", `Typing ${input.typedTextKind} data requires approval.`),
    );
  }

  if (
    input.submit ||
    input.maySubmit ||
    input.mayChangeState ||
    input.mayDelete ||
    input.mayUpload ||
    input.mayDownload ||
    input.mayPurchase
  ) {
    result = maxDecision(
      result,
      decision("requires_approval", "high", "Action may submit, change, delete, upload, download, or purchase."),
    );
  }

  if (
    ["click", "double_click", "keypress"].includes(input.actionType) &&
    textLooksDestructive(input.selector, input.visibleText)
  ) {
    result = maxDecision(
      result,
      decision("requires_approval", "high", "Action target appears destructive or irreversible."),
    );
  }

  if (input.authenticated && result.decision === "allowed" && input.actionType !== "screenshot" && input.actionType !== "extract_text" && input.actionType !== "wait") {
    result = maxDecision(
      result,
      decision("requires_approval", "medium", "Authenticated browser actions require user awareness."),
    );
  }

  return {
    ...result,
    reasons: [...new Set(result.reasons)],
  };
}
