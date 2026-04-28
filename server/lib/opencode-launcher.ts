import fs from "node:fs";
import path from "node:path";

export type OpenCodeLauncherSource = "env" | "embedded-package" | "global" | "test-harness";

export interface OpenCodeLauncher {
  command: string;
  argsPrefix: string[];
  displayName: string;
  source: OpenCodeLauncherSource;
  managedPackageVersion: string | null;
}

function readPackageVersion(packageJsonPath: string) {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export function configuredOpenCodeConfigDir() {
  return process.env.OPENCODE_CONFIG_DIR?.trim() || null;
}

export function resolveOpenCodeLauncher(projectRoot: string): OpenCodeLauncher {
  const envBinary = process.env.OPENCODE_BIN?.trim();
  if (envBinary) {
    return {
      command: envBinary,
      argsPrefix: [],
      displayName: envBinary,
      source: "env",
      managedPackageVersion: null,
    };
  }

  const packageRoot = path.join(projectRoot, "node_modules", "opencode-ai");
  const packageBin = path.join(packageRoot, "bin", "opencode");
  if (fs.existsSync(packageBin)) {
    return {
      // Run the JS launcher directly so Windows does not need shell=true for .cmd shims.
      command: process.execPath,
      argsPrefix: [packageBin],
      displayName: "opencode-ai",
      source: "embedded-package",
      managedPackageVersion: readPackageVersion(path.join(packageRoot, "package.json")),
    };
  }

  return {
    command: "opencode",
    argsPrefix: [],
    displayName: "opencode",
    source: "global",
    managedPackageVersion: null,
  };
}

export function createTestOpenCodeLauncher(): OpenCodeLauncher {
  return {
    command: "opencode-test-harness",
    argsPrefix: [],
    displayName: "opencode-test-harness",
    source: "test-harness",
    managedPackageVersion: null,
  };
}
