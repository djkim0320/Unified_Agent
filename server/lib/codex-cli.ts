import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

type CodexJsonEvent = Record<string, unknown>;

function resolveCodexCliScript() {
  if (process.env.CODEX_CLI_JS?.trim()) {
    return process.env.CODEX_CLI_JS.trim();
  }

  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    const candidate = path.join(
      appData,
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function createSpawnConfig(args: string[]) {
  const script = resolveCodexCliScript();
  if (script) {
    return {
      command: process.execPath,
      args: [script, ...args],
    };
  }

  return {
    command: process.platform === "win32" ? "codex.cmd" : "codex",
    args,
  };
}

async function runCodexCommand(params: {
  args: string[];
  cwd: string;
  stdinText?: string;
  timeoutMs?: number;
  onStdoutLine?: (line: string) => void;
}) {
  const spawnConfig = createSpawnConfig(params.args);

  return new Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(spawnConfig.command, spawnConfig.args, {
      cwd: params.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout =
      typeof params.timeoutMs === "number" && params.timeoutMs > 0
        ? setTimeout(() => {
            child.kill();
            if (!settled) {
              settled = true;
              reject(new Error("Codex command timed out"));
            }
          }, params.timeoutMs)
        : null;

    const finalize = (
      result:
        | { exitCode: number; stdout: string; stderr: string }
        | Error,
      isError: boolean,
    ) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (settled) {
        return;
      }
      settled = true;
      if (isError) {
        reject(result);
      } else {
        resolve(result as { exitCode: number; stdout: string; stderr: string });
      }
    };

    const stdoutReader = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    stdoutReader.on("line", (line) => {
      stdout += `${line}\n`;
      params.onStdoutLine?.(line);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => finalize(error, true));
    child.on("close", (code) => {
      stdoutReader.close();
      finalize(
        {
          exitCode: code ?? 0,
          stdout,
          stderr,
        },
        false,
      );
    });

    if (params.stdinText) {
      child.stdin.write(params.stdinText);
    }
    child.stdin.end();
  });
}

function trimTrailingNoise(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("WARN "))
    .join("\n");
}

export async function runCodexLoginStatus(cwd: string) {
  const result = await runCodexCommand({
    args: ["login", "status"],
    cwd,
    timeoutMs: 30_000,
  });

  return {
    ...result,
    summary: trimTrailingNoise(`${result.stdout}\n${result.stderr}`),
  };
}

export async function runCodexLogin(cwd: string) {
  const result = await runCodexCommand({
    args: ["login"],
    cwd,
    timeoutMs: 10 * 60_000,
  });

  if (result.exitCode !== 0) {
    throw new Error(trimTrailingNoise(result.stderr || result.stdout) || "Codex login failed");
  }

  return result;
}

export async function runCodexExec(params: {
  cwd: string;
  model: string;
  reasoningEffort?: string;
  prompt: string;
  onAgentMessage?: (text: string) => void;
}) {
  let finalAgentMessage = "";

  const result = await runCodexCommand({
    cwd: params.cwd,
    timeoutMs: 5 * 60_000,
    stdinText: params.prompt,
    args: [
      "-a",
      "never",
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--json",
      "--ephemeral",
      "-m",
      params.model,
      ...(params.reasoningEffort
        ? ["-c", `model_reasoning_effort=${params.reasoningEffort}`]
        : []),
      "-",
    ],
    onStdoutLine: (line) => {
      let event: CodexJsonEvent;
      try {
        event = JSON.parse(line) as CodexJsonEvent;
      } catch {
        return;
      }

      const item =
        typeof event.item === "object" && event.item !== null
          ? (event.item as Record<string, unknown>)
          : null;

      if (
        event.type === "item.completed" &&
        item?.type === "agent_message" &&
        typeof item.text === "string"
      ) {
        finalAgentMessage = item.text;
        params.onAgentMessage?.(item.text);
      }
    },
  });

  if (result.exitCode !== 0) {
    throw new Error(trimTrailingNoise(result.stderr || result.stdout) || "Codex exec failed");
  }

  if (!finalAgentMessage.trim()) {
    throw new Error("Codex did not produce an assistant response");
  }

  return {
    ...result,
    finalAgentMessage,
  };
}
