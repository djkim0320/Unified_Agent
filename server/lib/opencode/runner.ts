import { spawn } from "node:child_process";
import {
  appendCappedText,
  createProcessTreeLaunchOptions,
  spawnedAsProcessGroup,
  terminateProcessTree,
} from "../process-control.js";
import type { OpenCodeLauncher } from "../opencode-launcher.js";

const MAX_CAPTURED_OUTPUT_BYTES = 128_000;

export interface OpenCodeCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  errorMessage: string | null;
}

export interface OpenCodeCommandRunner {
  run: (args: string[], options: OpenCodeRunnerOptions) => Promise<OpenCodeCommandResult>;
  runStreaming: (args: string[], options: OpenCodeRunnerOptions) => Promise<OpenCodeCommandResult>;
}

export interface OpenCodeRunnerOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal;
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
}

export function makeOpenCodeRunner(launcher: OpenCodeLauncher): OpenCodeCommandRunner {
  async function execute(args: string[], options: OpenCodeRunnerOptions) {
    return new Promise<OpenCodeCommandResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      let cancelled = false;
      const stdoutState = { truncated: false };
      const stderrState = { truncated: false };
      const child = spawn(launcher.command, [...launcher.argsPrefix, ...args], {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        // opencode treats an open non-TTY stdin as extra prompt input. The server never streams
        // stdin to CLI runs, so close it explicitly to avoid silent hangs in background tasks.
        stdio: ["ignore", "pipe", "pipe"],
        ...createProcessTreeLaunchOptions(),
      });
      const processGroup = spawnedAsProcessGroup(child);
      let abortHandler: (() => void) | null = null;
      const cleanupAbortListener = () => {
        if (abortHandler) {
          options.signal?.removeEventListener("abort", abortHandler);
        }
      };
      const finish = (result: OpenCodeCommandResult) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        cleanupAbortListener();
        resolve(result);
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        void terminateProcessTree(child.pid, { processGroup }).finally(() => {
          finish({
            exitCode: null,
            stdout,
            stderr,
            timedOut,
            cancelled,
            errorMessage: "opencode command timed out.",
          });
        });
      }, options.timeoutMs);

      abortHandler = () => {
        cancelled = true;
        void terminateProcessTree(child.pid, { processGroup }).finally(() => {
          finish({
            exitCode: null,
            stdout,
            stderr,
            timedOut,
            cancelled,
            errorMessage: "opencode command was cancelled.",
          });
        });
      };
      if (options.signal?.aborted) {
        abortHandler();
        return;
      }
      options.signal?.addEventListener("abort", abortHandler, { once: true });

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = appendCappedText(stdout, chunk, stdoutState, MAX_CAPTURED_OUTPUT_BYTES, "stdout");
        options.onStdoutChunk?.(chunk.toString("utf8"));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = appendCappedText(stderr, chunk, stderrState, MAX_CAPTURED_OUTPUT_BYTES, "stderr");
        options.onStderrChunk?.(chunk.toString("utf8"));
      });
      child.on("error", (error) => {
        finish({
          exitCode: null,
          stdout,
          stderr,
          timedOut,
          cancelled,
          errorMessage: error.message,
        });
      });
      child.on("close", (exitCode) => {
        finish({
          exitCode,
          stdout,
          stderr,
          timedOut,
          cancelled,
          errorMessage: null,
        });
      });
    });
  }

  return {
    run: execute,
    runStreaming: execute,
  };
}

export function makeOpenCodeTestHarnessRunner(): OpenCodeCommandRunner {
  async function run(args: string[]): Promise<OpenCodeCommandResult> {
    const [command] = args;
    if (command === "--version") {
      return {
        exitCode: 0,
        stdout: "opencode test harness\n",
        stderr: "",
        timedOut: false,
        cancelled: false,
        errorMessage: null,
      };
    }
    if (command === "models") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          models: [
            "openai/gpt-5.5",
            "openai/gpt-5.4",
            "anthropic/claude-sonnet-4-6",
            "google/gemini-3.1-pro-preview",
          ],
        }),
        stderr: "",
        timedOut: false,
        cancelled: false,
        errorMessage: null,
      };
    }
    if (command === "session") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({ sessions: [] }),
        stderr: "",
        timedOut: false,
        cancelled: false,
        errorMessage: null,
      };
    }
    if (command === "auth") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({ providers: ["openai"] }),
        stderr: "",
        timedOut: false,
        cancelled: false,
        errorMessage: null,
      };
    }
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      cancelled: false,
      errorMessage: null,
    };
  }

  async function runStreaming(
    args: string[],
    options: OpenCodeRunnerOptions,
  ): Promise<OpenCodeCommandResult> {
    const modelIndex = args.indexOf("--model");
    const model = modelIndex >= 0 ? args[modelIndex + 1] : "unknown-model";
    const prompt = args.at(-1) ?? "";
    options.onStdoutChunk?.(
      JSON.stringify({ type: "session", sessionID: "opencode-test-session" }) + "\n",
    );

    if (prompt.includes("User request:\nhang")) {
      return await new Promise<OpenCodeCommandResult>((resolve) => {
        const finish = () =>
          resolve({
            exitCode: null,
            stdout: "",
            stderr: "",
            timedOut: false,
            cancelled: true,
            errorMessage: "opencode command was cancelled.",
          });
        if (options.signal?.aborted) {
          finish();
          return;
        }
        const timeout = setTimeout(finish, Math.min(options.timeoutMs, 1_000));
        options.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            finish();
          },
          { once: true },
        );
      });
    }

    options.onStdoutChunk?.(
      JSON.stringify({
        type: "assistant",
        text: "Hello",
        model,
      }) + "\n",
    );
    options.onStdoutChunk?.(
      JSON.stringify({
        type: "assistant",
        text: " world",
        model,
      }) + "\n",
    );
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      cancelled: false,
      errorMessage: null,
    };
  }

  return {
    run,
    runStreaming,
  };
}
