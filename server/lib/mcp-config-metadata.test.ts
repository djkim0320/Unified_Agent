import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyMcpSnippetToManagedConfig, validateMcpSnippet } from "./mcp-config-metadata.js";

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

  it("applies validated snippets to the managed opencode config without exposing backup paths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherops-mcp-"));
    const configPath = path.join(dir, "opencode.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        model: "openai/gpt-5.4",
        mcp: {
          filesystem: {
            type: "stdio",
            command: "mock-fs",
          },
        },
      }),
    );

    const result = applyMcpSnippetToManagedConfig({
      managedConfigPath: configPath,
      snippet: JSON.stringify({
        mcp: {
          github: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: {
              GITHUB_TOKEN: "{env:GITHUB_TOKEN}",
            },
          },
        },
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.backupCreated).toBe(true);
    expect(result.backupPath).toBeNull();
    const written = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(written.model).toBe("openai/gpt-5.4");
    expect(written.mcp.filesystem.command).toBe("mock-fs");
    expect(written.mcp.github.command).toBe("npx");
  });
});
