import { describe, expect, it } from "vitest";
import { redactSensitiveText, redactUnknown } from "./redaction.js";

describe("safe redaction", () => {
  it("redacts common tokens, auth headers, env secrets, and local paths", () => {
    const redacted = redactSensitiveText(
      [
        "Authorization: Bearer sk-1234567890abcdef1234567890abcdef",
        "OPENAI_API_KEY=sk-test1234567890abcdef1234567890abcdef",
        "file=C:\\Users\\alice\\secret\\token.txt",
        "/home/alice/.config/opencode/auth.json",
      ].join("\n"),
    );

    expect(redacted).not.toContain("sk-1234567890abcdef");
    expect(redacted).not.toContain("C:\\Users\\alice");
    expect(redacted).not.toContain("/home/alice");
    expect(redacted).toContain("[redacted]");
  });

  it("removes raw prompt-shaped fields from nested debug objects", () => {
    const redacted = redactUnknown({
      prompt: "please inspect my private prompt",
      payload: {
        resultText: "raw result",
        note: "Bearer rk-1234567890abcdef1234567890abcdef",
      },
    });

    expect(redacted).toEqual({
      prompt: "[hidden]",
      payload: {
        resultText: "[hidden]",
        note: expect.stringContaining("[redacted]"),
      },
    });
  });
});
