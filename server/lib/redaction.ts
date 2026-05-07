const MAX_SAFE_LINE_LENGTH = 1200;

const SECRET_ASSIGNMENT_PATTERN =
  /\b([A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|AUTH)[A-Z0-9_]*)\s*=\s*([^\s"'`<>]{8,})/gi;

export function redactSensitiveText(value: string, options?: { maxLineLength?: number }) {
  const maxLineLength = options?.maxLineLength ?? MAX_SAFE_LINE_LENGTH;
  return value
    .split(/\r?\n/)
    .map((line) => {
      const redacted = line
        .replace(/\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Authorization: Bearer [redacted]")
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [redacted]")
        .replace(/\b(?:sk|rk|pk|sess|ghp|gho|ghu|github_pat|xox[abprs])[-_A-Za-z0-9]{12,}\b/g, "[redacted secret]")
        .replace(SECRET_ASSIGNMENT_PATTERN, "$1=[redacted]")
        .replace(/\b[A-Za-z]:[\\/][^\s'"<>]+/g, "[local path]")
        .replace(/\\\\[^\s'"<>]+/g, "[local path]")
        .replace(/\/(?:Users|home|var|tmp|mnt|Volumes)\/[^\s'"<>]+/g, "[local path]");
      return redacted.length > maxLineLength ? `${redacted.slice(0, maxLineLength)}... [truncated]` : redacted;
    })
    .join("\n");
}

export function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactUnknown);
  }
  if (typeof value === "object" && value !== null) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/prompt|userMessage|resultText/i.test(key)) {
        output[key] = "[hidden]";
      } else {
        output[key] = redactUnknown(item);
      }
    }
    return output;
  }
  return value;
}
