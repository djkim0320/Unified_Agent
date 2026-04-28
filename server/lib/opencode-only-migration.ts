import fs from "node:fs";
import path from "node:path";

const MIGRATION_MARKER_FILE = "opencode-only-migration.json";

export interface OpenCodeOnlyMigrationResult {
  applied: boolean;
  markerPath: string;
  deleted: string[];
}

function assertInside(parent: string, target: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to migrate path outside ${parent}.`);
  }
}

function removeLegacyPath(workspaceRoot: string, relativePath: string) {
  const target = path.join(workspaceRoot, relativePath);
  assertInside(workspaceRoot, target);
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat) {
    return false;
  }
  fs.rmSync(target, {
    recursive: !stat.isSymbolicLink(),
    force: true,
  });
  return true;
}

/**
 * One-time migration for the opencode-only runtime.
 *
 * Only AetherOps' old internal workspace runtime directories are removed.
 * The SQLite database, encrypted provider secrets, local API token, and other
 * files under `.data` are intentionally not touched.
 */
export function runOpenCodeOnlyWorkspaceMigration(params: {
  projectRoot: string;
  dataDir: string;
}): OpenCodeOnlyMigrationResult {
  const markerPath = path.join(params.dataDir, MIGRATION_MARKER_FILE);
  if (fs.existsSync(markerPath)) {
    return {
      applied: false,
      markerPath,
      deleted: [],
    };
  }

  const workspaceRoot = path.join(params.projectRoot, "workspace");
  const legacyTargets = ["agents", path.join("shared", "skills"), path.join("shared", "plugins")];
  const deleted = legacyTargets
    .filter((relativePath) => removeLegacyPath(workspaceRoot, relativePath))
    .map((relativePath) => relativePath.replace(/\\/g, "/"));

  fs.mkdirSync(params.dataDir, { recursive: true });
  fs.writeFileSync(
    markerPath,
    JSON.stringify(
      {
        version: 1,
        migratedAt: new Date().toISOString(),
        deleted,
        preserved: [".data", ".data/chat.sqlite", ".data/secret.key", ".data/local-api.token"],
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    applied: true,
    markerPath,
    deleted,
  };
}
