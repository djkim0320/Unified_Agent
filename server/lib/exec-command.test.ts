import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runWorkspaceCommand } from "./exec-command.js";

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "workspace-exec-"));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith("workspace-exec-")) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
});

function createChildMarkerScript(markerPath: string) {
  const childCode = `
    const fs = require("node:fs");
    const marker = process.argv[1];
    setTimeout(() => {
      fs.writeFileSync(marker, "child-alive", "utf8");
    }, 1200);
    setInterval(() => {}, 1000);
  `;

  return `
    const { spawn } = require("node:child_process");
    spawn(process.execPath, ["-e", ${JSON.stringify(childCode)}, ${JSON.stringify(markerPath)}], {
      stdio: "ignore",
      windowsHide: true,
    });
    setInterval(() => {}, 1000);
  `;
}

describe("runWorkspaceCommand", () => {
  it("runs a safe structured command successfully", async () => {
    const cwd = createTempDir();
    const result = await runWorkspaceCommand({
      program: process.execPath,
      args: ["-e", 'process.stdout.write("ok")'],
      cwd,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(result.stderr).toBe("");
  });

  it("runs commands with the provided workspace cwd for relative paths", async () => {
    const cwd = createTempDir();
    const markerName = `cwd-marker-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`;
    const result = await runWorkspaceCommand({
      program: process.execPath,
      args: [
        "-e",
        [
          'const fs = require("node:fs");',
          `fs.writeFileSync(${JSON.stringify(markerName)}, "created", "utf8");`,
          "process.stdout.write(process.cwd());",
        ].join(" "),
      ],
      cwd,
    });

    expect(path.normalize(result.stdout)).toBe(path.normalize(cwd));
    expect(fs.readFileSync(path.join(cwd, markerName), "utf8")).toBe("created");
    expect(fs.existsSync(path.join(process.cwd(), markerName))).toBe(false);
  });

  it("blocks shell execution by default", async () => {
    const cwd = createTempDir();

    await expect(
      runWorkspaceCommand({
        program: process.platform === "win32" ? "powershell.exe" : "sh",
        args: process.platform === "win32" ? ["-Command", "Write-Output hi"] : ["-c", "echo hi"],
        cwd,
      }),
    ).rejects.toThrow(/disabled by default/i);
  });

  it("caps stdout output", async () => {
    const cwd = createTempDir();
    const result = await runWorkspaceCommand({
      program: process.execPath,
      args: ["-e", 'process.stdout.write("x".repeat(500))'],
      cwd,
      stdoutMaxBytes: 64,
    });

    expect(result.stdout).toContain("[stdout truncated after 64 bytes]");
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(128);
  });

  it("terminates the full process tree on timeout", async () => {
    const cwd = createTempDir();
    const markerPath = path.join(cwd, "timeout-marker.txt");

    await expect(
      runWorkspaceCommand({
        program: process.execPath,
        args: ["-e", createChildMarkerScript(markerPath)],
        cwd,
        timeoutMs: 200,
      }),
    ).rejects.toThrow(/timed out/i);

    await delay(1_800);
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  it("cancels command execution without leaving child processes behind", async () => {
    const cwd = createTempDir();
    const markerPath = path.join(cwd, "abort-marker.txt");
    const controller = new AbortController();

    const pending = runWorkspaceCommand({
      program: process.execPath,
      args: ["-e", createChildMarkerScript(markerPath)],
      cwd,
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 200);

    await expect(pending).rejects.toThrow(/cancelled/i);
    await delay(1_800);
    expect(fs.existsSync(markerPath)).toBe(false);
  });
});
