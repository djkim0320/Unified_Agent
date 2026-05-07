import { describe, expect, it } from "vitest";
import { validateMcpSnippet } from "./mcp-config-metadata.js";

describe("MCP config metadata", () => {
  it("validates safe opencode MCP snippets without executing MCP servers", () => {
    const validation = validateMcpSnippet(
      JSON.stringify({
        mcp: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "${AETHEROPS_SESSION_WORKSPACE}"],
          },
        },
      }),
    );

    expect(validation.ok).toBe(true);
    expect(validation.parsedServerCount).toBe(1);
    expect(validation.envPlaceholders).toContain("AETHEROPS_SESSION_WORKSPACE");
    expect(validation.configuredServers[0]).toEqual(
      expect.objectContaining({
        category: "filesystem",
        status: "configured",
      }),
    );
  });

  it("rejects snippets that contain literal token-looking values", () => {
    const validation = validateMcpSnippet(
      JSON.stringify({
        mcp: {
          github: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: {
              GITHUB_TOKEN: "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
            },
          },
        },
      }),
    );

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(" ")).toMatch(/secret|token/i);
  });
});
