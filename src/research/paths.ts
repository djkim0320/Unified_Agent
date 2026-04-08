import fs from "node:fs/promises";
import path from "node:path";

const RESEARCH_DIRNAME = ".openclaw-research";

async function realpathOrResolve(inputPath: string): Promise<string> {
  const resolved = path.resolve(inputPath);
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

export async function resolveWorkspaceRoot(workspaceDir: string): Promise<string> {
  return await realpathOrResolve(workspaceDir);
}

export function resolveResearchRootPath(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), RESEARCH_DIRNAME);
}

export function resolveProjectManifestPath(workspaceDir: string): string {
  return path.join(resolveResearchRootPath(workspaceDir), "project.json");
}

export function resolveProjectRunsDir(workspaceDir: string): string {
  return path.join(resolveResearchRootPath(workspaceDir), "runs");
}

export function resolveProjectRunMetadataPath(workspaceDir: string, runId: string): string {
  return path.join(resolveProjectRunsDir(workspaceDir), `${runId}.json`);
}

export function resolveProjectRunLogPath(workspaceDir: string, runId: string): string {
  return path.join(resolveProjectRunsDir(workspaceDir), `${runId}.log`);
}

export function resolveProjectArtifactsDir(workspaceDir: string): string {
  return path.join(resolveResearchRootPath(workspaceDir), "artifacts");
}

export function resolveProjectArtifactsIndexPath(workspaceDir: string): string {
  return path.join(resolveProjectArtifactsDir(workspaceDir), "index.json");
}

export function resolveRunArtifactsDir(workspaceDir: string, runId: string): string {
  return path.join(resolveProjectArtifactsDir(workspaceDir), runId);
}

export async function ensureResearchLayout(workspaceDir: string): Promise<void> {
  const root = resolveResearchRootPath(workspaceDir);
  await Promise.all([
    fs.mkdir(root, { recursive: true }),
    fs.mkdir(resolveProjectRunsDir(workspaceDir), { recursive: true }),
    fs.mkdir(resolveProjectArtifactsDir(workspaceDir), { recursive: true }),
  ]);
}
