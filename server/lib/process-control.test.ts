import { describe, expect, it, vi } from "vitest";
import { terminateProcessTree } from "./process-control.js";

describe("terminateProcessTree", () => {
  it("kills a POSIX process group before falling back to the direct process", async () => {
    const calls: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const killProcess = vi.fn((pid: number, signal?: NodeJS.Signals | number): true => {
      calls.push({ pid, signal: signal as NodeJS.Signals });
      return true;
    });

    await terminateProcessTree(1234, {
      platform: "linux",
      processGroup: true,
      killProcess,
    });

    expect(calls).toEqual([{ pid: -1234, signal: "SIGKILL" }]);
  });

  it("falls back to direct POSIX process termination when group termination fails", async () => {
    const calls: number[] = [];
    const killProcess = vi.fn((pid: number): true => {
      calls.push(pid);
      if (pid < 0) {
        throw new Error("group missing");
      }
      return true;
    });

    await terminateProcessTree(5678, {
      platform: "linux",
      processGroup: true,
      killProcess,
    });

    expect(calls).toEqual([-5678, 5678]);
  });

  it("uses taskkill tree termination on Windows", async () => {
    const spawnProcess = vi.fn((_command: string, _args: string[], _options: object) => {
      const listeners = new Map<string, () => void>();
      const child = {
        on(event: string, listener: () => void) {
          listeners.set(event, listener);
          if (event === "close") {
            queueMicrotask(listener);
          }
          return child;
        },
      };
      return child;
    });

    await terminateProcessTree(2468, {
      platform: "win32",
      spawnProcess: spawnProcess as never,
    });

    expect(spawnProcess).toHaveBeenCalledWith(
      "taskkill.exe",
      ["/PID", "2468", "/T", "/F"],
      expect.objectContaining({
        stdio: "ignore",
        windowsHide: true,
      }),
    );
  });
});
