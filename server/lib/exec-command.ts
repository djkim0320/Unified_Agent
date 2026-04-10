import { spawn } from "node:child_process";

export async function runWorkspaceCommand(params: {
  command: string;
  cwd: string;
  timeoutMs?: number;
}) {
  return new Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        params.command,
      ],
      {
        cwd: params.cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeoutMs = params.timeoutMs ?? 30_000;
    const timeout = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error("Workspace command timed out."));
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        resolve({
          exitCode: code ?? 0,
          stdout,
          stderr,
        });
      }
    });
  });
}

