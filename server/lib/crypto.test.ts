import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSecretBox } from "./crypto.js";

const tempDirs: string[] = [];

function createTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crypto-hardening-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("secret key hardening", () => {
  it("creates a durable encryption key and round-trips encrypted values", () => {
    const dataDir = createTempDataDir();
    const box = createSecretBox(dataDir);
    const encrypted = box.encrypt({ apiKey: "sk-test" });

    expect(encrypted).not.toContain("sk-test");
    expect(box.decrypt<{ apiKey: string }>(encrypted)).toEqual({ apiKey: "sk-test" });
    expect(fs.readFileSync(path.join(dataDir, "secret.key"))).toHaveLength(32);
  });

  it("best-effort hardens key permissions on Unix-like systems", () => {
    const dataDir = createTempDataDir();
    createSecretBox(dataDir);

    if (process.platform === "win32") {
      expect(fs.existsSync(path.join(dataDir, "secret.key"))).toBe(true);
      return;
    }

    const mode = fs.statSync(path.join(dataDir, "secret.key")).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
