import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

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

export type ProcessTreeLaunchOptions = {
  detached: boolean;
  windowsHide: true;
};

export function createProcessTreeLaunchOptions(): ProcessTreeLaunchOptions {
  return {
    detached: process.platform !== "win32",
    windowsHide: true,
  };
}

export async function terminateProcessTree(
  pid: number | undefined,
  options?: {
    processGroup?: boolean;
    killProcess?: typeof process.kill;
    spawnProcess?: typeof spawn;
    platform?: NodeJS.Platform;
  },
) {
  if (!pid || pid <= 0) {
    return;
  }

  const platform = options?.platform ?? process.platform;
  const spawnProcess = options?.spawnProcess ?? spawn;
  const killProcess = options?.killProcess ?? process.kill;

  if (platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawnProcess("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", () => resolve());
      killer.on("close", () => resolve());
    });
    return;
  }

  const targets = options?.processGroup ? [-pid, pid] : [pid];
  for (const target of targets) {
    try {
      killProcess(target, "SIGKILL");
      return;
    } catch {
      // Ignore races where the process or process group already exited.
    }
  }
}

export function spawnedAsProcessGroup(child: Pick<ChildProcess, "pid">) {
  return process.platform !== "win32" && Boolean(child.pid);
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
