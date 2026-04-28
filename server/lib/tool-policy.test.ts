import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createToolRegistry, type ToolDescriptor } from "./tool-registry.js";
import { evaluateToolPermissionPolicy } from "./tool-policy.js";

function descriptor(overrides: Partial<ToolDescriptor>): ToolDescriptor {
  return {
    name: "read_file",
    description: "Read a file",
    permission: "workspace",
    schema: z.object({}),
    example: "{}",
    async execute() {
      return {};
    },
    ...overrides,
  };
}

describe("tool permission policy", () => {
  it("classifies low, medium, and high risk tools", () => {
    expect(
      evaluateToolPermissionPolicy({
        descriptor: descriptor({ name: "read_file" }),
        arguments: {},
      }).risk,
    ).toBe("low");

    expect(
      evaluateToolPermissionPolicy({
        descriptor: descriptor({ name: "write_file" }),
        arguments: { path: "notes.txt" },
      }),
    ).toEqual(
      expect.objectContaining({
        risk: "medium",
        approvalRecommended: true,
        approvalRequired: false,
      }),
    );

    expect(
      evaluateToolPermissionPolicy({
        descriptor: descriptor({ name: "exec_command", permission: "exec" }),
        arguments: { program: "node", args: ["--version"] },
      }),
    ).toEqual(
      expect.objectContaining({
        risk: "high",
        approvalRecommended: true,
        approvalRequired: true,
      }),
    );
  });

  it("rejects duplicate tool registration", () => {
    const registry = createToolRegistry();
    const tool = descriptor({ name: "duplicate_tool" });

    registry.register(tool);
    expect(() => registry.register(tool)).toThrow(/already registered/i);
  });

  it("hides computer-use tools from the planner until the feature is enabled", () => {
    const registry = createToolRegistry();
    registry.register(
      descriptor({
        name: "computer.browser.screenshot",
        permission: "browser",
        risk: "low",
        audit: {
          category: "computer_use",
          safeByDefault: true,
        },
      }),
    );

    expect(registry.listAllowed({ computerUseEnabled: false })).toHaveLength(0);
    expect(registry.listAllowed({ computerUseEnabled: true })).toHaveLength(1);
  });
});
