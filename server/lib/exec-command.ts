import { spawn } from "node:child_process";
import {
  appendCappedText,
  createAbortError,
  createSanitizedEnvironment,
  isShellProgram,
  terminateProcessTree,
} from "./process-control.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_STDOUT_MAX_BYTES = 64 * 1024;
const DEFAULT_STDERR_MAX_BYTES = 32 * 1024;

function normalizeTimeout(timeoutMs: number | undefined) {
  if (!Number.isFinite(timeoutMs ?? DEFAULT_TIMEOUT_MS)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.max(1, Math.min(Math.floor(timeoutMs ?? DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS));
}

function assertSafeProgram(program: string, allowUnsafeShell: boolean) {
  if (!program.trim()) {
    throw new Error("exec_command requires a program name.");
  }

  if (isShellProgram(program) && !allowUnsafeShell) {
    throw new Error(
      "Shell execution is disabled by default. Use a direct program with args, or set ENABLE_UNSAFE_WORKSPACE_EXEC=true explicitly.",
    );
  }
}

export async function runWorkspaceCommand(params: {
  program: string;
  args?: string[];
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  stdoutMaxBytes?: number;
  stderrMaxBytes?: number;
  allowUnsafeShell?: boolean;
}) {
  const allowUnsafeShell =
    params.allowUnsafeShell ?? process.env.ENABLE_UNSAFE_WORKSPACE_EXEC === "true";
  assertSafeProgram(params.program, allowUnsafeShell);

  if (params.signal?.aborted) {
    throw createAbortError();
  }

  const timeoutMs = normalizeTimeout(params.timeoutMs);
  const stdoutMaxBytes = params.stdoutMaxBytes ?? DEFAULT_STDOUT_MAX_BYTES;
  const stderrMaxBytes = params.stderrMaxBytes ?? DEFAULT_STDERR_MAX_BYTES;

  return await new Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>((resolve, reject) => {
    const child = spawn(params.program, params.args ?? [], {
      cwd: params.cwd,
      env: createSanitizedEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const stdoutState = { truncated: false };
    const stderrState = { truncated: false };

    const cleanupAndReject = async (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      params.signal?.removeEventListener("abort", abortListener);
      await terminateProcessTree(child.pid);
      reject(error);
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      void cleanupAndReject(new Error(`Workspace command timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    const abortListener = () => {
      void cleanupAndReject(createAbortError("Workspace command was cancelled."));
    };

    params.signal?.addEventListener("abort", abortListener, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendCappedText(stdout, chunk, stdoutState, stdoutMaxBytes, "stdout");
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendCappedText(stderr, chunk, stderrState, stderrMaxBytes, "stderr");
    });

    child.on("error", (error) => {
      void cleanupAndReject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      params.signal?.removeEventListener("abort", abortListener);
      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}
