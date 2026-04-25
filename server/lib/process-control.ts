import { spawn } from "node:child_process";

const WINDOWS_SAFE_ENV_KEYS = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROGRAMDATA",
  "PUBLIC",
  "USERPROFILE",
  "USERNAME",
  "HOME",
];

const BLOCKED_SHELL_PROGRAMS = new Set([
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "cmd",
  "cmd.exe",
  "bash",
  "bash.exe",
  "sh",
  "sh.exe",
  "zsh",
  "zsh.exe",
]);

export function createAbortError(message = "Operation cancelled.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown) {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

export function isShellProgram(program: string) {
  return BLOCKED_SHELL_PROGRAMS.has(program.trim().split(/[\\/]/).pop()?.toLowerCase() ?? "");
}

export function createSanitizedEnvironment(overrides?: NodeJS.ProcessEnv) {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of WINDOWS_SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      environment[key] = value;
    }
  }

  return {
    ...environment,
    ...(overrides ?? {}),
  };
}

export async function terminateProcessTree(pid: number | undefined) {
  if (!pid || pid <= 0) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", () => resolve());
      killer.on("close", () => resolve());
    });
    return;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Ignore races where the process already exited.
  }
}

export function appendCappedText(
  current: string,
  chunk: Buffer,
  state: { truncated: boolean },
  maxBytes: number,
  label: "stdout" | "stderr",
) {
  if (state.truncated) {
    return current;
  }

  const nextChunk = chunk.toString("utf8");
  const nextValue = current + nextChunk;
  if (Buffer.byteLength(nextValue, "utf8") <= maxBytes) {
    return nextValue;
  }

  const remainingBytes = Math.max(0, maxBytes - Buffer.byteLength(current, "utf8"));
  const clipped = chunk.subarray(0, remainingBytes).toString("utf8");
  state.truncated = true;
  return `${current}${clipped}\n[${label} truncated after ${maxBytes} bytes]`;
}
