import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runOpenCodeOnlyWorkspaceMigration } from "./opencode-only-migration.js";

const tempRoots: string[] = [];

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-only-migration-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("opencode-only workspace migration", () => {
  it("removes only legacy AetherOps runtime workspace directories on first run", () => {
    const projectRoot = makeRoot();
    const dataDir = path.join(projectRoot, ".data");
    fs.mkdirSync(path.join(projectRoot, "workspace", "agents", "default-agent"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "workspace", "shared", "skills"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "workspace", "shared", "plugins"), { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "chat.sqlite"), "db", "utf8");
    fs.writeFileSync(path.join(dataDir, "secret.key"), "secret", "utf8");

    const result = runOpenCodeOnlyWorkspaceMigration({ projectRoot, dataDir });

    expect(result.applied).toBe(true);
    expect(result.deleted.sort()).toEqual(["agents", "shared/plugins", "shared/skills"]);
    expect(fs.existsSync(path.join(projectRoot, "workspace", "agents"))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, "workspace", "shared", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, "workspace", "shared", "plugins"))).toBe(false);
    expect(fs.readFileSync(path.join(dataDir, "chat.sqlite"), "utf8")).toBe("db");
    expect(fs.readFileSync(path.join(dataDir, "secret.key"), "utf8")).toBe("secret");
    expect(fs.existsSync(path.join(dataDir, "opencode-only-migration.json"))).toBe(true);
  });

  it("does not repeat deletion after the marker exists", () => {
    const projectRoot = makeRoot();
    const dataDir = path.join(projectRoot, ".data");
    fs.mkdirSync(dataDir, { recursive: true });

    runOpenCodeOnlyWorkspaceMigration({ projectRoot, dataDir });
    const recreatedLegacyPath = path.join(projectRoot, "workspace", "agents", "manual-check");
    fs.mkdirSync(recreatedLegacyPath, { recursive: true });

    const result = runOpenCodeOnlyWorkspaceMigration({ projectRoot, dataDir });

    expect(result.applied).toBe(false);
    expect(fs.existsSync(recreatedLegacyPath)).toBe(true);
  });
});
