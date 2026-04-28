import { describe, expect, it } from "vitest";
import { evaluateComputerUsePolicy } from "./policy.js";

const enabledSettings = {
  enabled: true,
  allowExternalDomains: [],
  allowFileUrls: false,
};

describe("computer use policy", () => {
  it("allows localhost browser automation by default", () => {
    expect(
      evaluateComputerUsePolicy({
        actionType: "navigate",
        targetUrl: "http://127.0.0.1:5173",
        settings: enabledSettings,
      }),
    ).toEqual(
      expect.objectContaining({
        decision: "allowed",
      }),
    );
  });

  it("blocks arbitrary external domains unless allowlisted", () => {
    expect(
      evaluateComputerUsePolicy({
        actionType: "navigate",
        targetUrl: "https://example.com",
        settings: enabledSettings,
      }),
    ).toEqual(
      expect.objectContaining({
        decision: "blocked",
      }),
    );
  });

  it("requires approval for allowlisted external navigation", () => {
    expect(
      evaluateComputerUsePolicy({
        actionType: "navigate",
        targetUrl: "https://docs.example.com",
        settings: {
          ...enabledSettings,
          allowExternalDomains: ["example.com"],
        },
      }),
    ).toEqual(
      expect.objectContaining({
        decision: "requires_approval",
      }),
    );
  });

  it("requires approval for sensitive typing and submit-like clicks", () => {
    expect(
      evaluateComputerUsePolicy({
        actionType: "type",
        currentUrl: "http://localhost:5173",
        typedTextKind: "password",
        settings: enabledSettings,
      }),
    ).toEqual(expect.objectContaining({ decision: "requires_approval" }));

    expect(
      evaluateComputerUsePolicy({
        actionType: "click",
        currentUrl: "http://localhost:5173",
        visibleText: "Delete project",
        settings: enabledSettings,
      }),
    ).toEqual(expect.objectContaining({ decision: "requires_approval" }));
  });

  it("blocks metadata and private network hosts", () => {
    expect(
      evaluateComputerUsePolicy({
        actionType: "navigate",
        targetUrl: "http://169.254.169.254/latest/meta-data",
        settings: enabledSettings,
      }).decision,
    ).toBe("blocked");
  });
});
