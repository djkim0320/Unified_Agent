import fs from "node:fs/promises";
import path from "node:path";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import { pathExists, readJsonFile, readTextSnippet, writeJsonFile } from "./fs.js";
import {
  ensureResearchLayout,
  resolveProjectArtifactsIndexPath,
  resolveRunArtifactsDir,
  resolveWorkspaceRoot,
} from "./paths.js";
import type {
  ResearchAddonId,
  ResearchArtifactPreview,
  ResearchArtifactRecord,
  ResearchProjectManifest,
} from "./types.js";

function buildPreviewKind(type: string): ResearchArtifactPreview["kind"] {
  const normalized = type.trim().toLowerCase();
  if (normalized === "json") return "json";
  if (normalized === "csv") return "csv";
  if (normalized === "markdown" || normalized === "md") return "markdown";
  if (normalized === "png" || normalized === "jpg" || normalized === "jpeg") return "image";
  if (normalized === "step" || normalized === "stp") return "step";
  if (normalized === "txt" || normalized === "text") return "text";
  return "unknown";
}

async function readArtifactIndex(workspaceDir: string): Promise<ResearchArtifactRecord[]> {
  return await readJsonFile<ResearchArtifactRecord[]>(
    resolveProjectArtifactsIndexPath(workspaceDir),
    [],
  );
}

async function writeArtifactIndex(
  workspaceDir: string,
  artifacts: ResearchArtifactRecord[],
): Promise<void> {
  await writeJsonFile(resolveProjectArtifactsIndexPath(workspaceDir), artifacts);
}

function buildArtifactId(runId: string, name: string): string {
  const safeName = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return `${runId}:${safeName}`;
}

export async function registerResearchArtifacts(params: {
  project: ResearchProjectManifest;
  runId: string;
  addonId: ResearchAddonId;
  items: Array<{
    name: string;
    type: string;
    sourcePath: string;
    preview?: ResearchArtifactPreview;
    createdAt?: number;
  }>;
}): Promise<ResearchArtifactRecord[]> {
  await ensureResearchLayout(params.project.workspacePath);
  const workspaceRoot = await resolveWorkspaceRoot(params.project.workspacePath);
  const index = await readArtifactIndex(workspaceRoot);
  const next = [...index];
  const createdAt = Date.now();
  const records: ResearchArtifactRecord[] = [];
  for (const item of params.items) {
    const record: ResearchArtifactRecord = {
      artifactId: buildArtifactId(params.runId, item.name),
      projectId: params.project.id,
      runId: params.runId,
      addonId: params.addonId,
      name: item.name,
      type: item.type,
      path: path.resolve(item.sourcePath),
      createdAt: item.createdAt ?? createdAt,
      preview: item.preview,
    };
    const existingIndex = next.findIndex((entry) => entry.artifactId === record.artifactId);
    if (existingIndex >= 0) {
      next[existingIndex] = record;
    } else {
      next.push(record);
    }
    records.push(record);
  }
  await writeArtifactIndex(workspaceRoot, next.toSorted((a, b) => b.createdAt - a.createdAt));
  return records;
}

export async function listResearchArtifacts(params: {
  project: ResearchProjectManifest;
  addonId?: string;
  runId?: string;
  type?: string;
}): Promise<ResearchArtifactRecord[]> {
  const artifacts = await readArtifactIndex(params.project.workspacePath);
  return artifacts
    .filter((artifact) => {
      if (artifact.projectId !== params.project.id) {
        return false;
      }
      if (params.addonId && artifact.addonId !== params.addonId) {
        return false;
      }
      if (params.runId && artifact.runId !== params.runId) {
        return false;
      }
      if (params.type && artifact.type !== params.type) {
        return false;
      }
      return true;
    })
    .toSorted((a, b) => b.createdAt - a.createdAt);
}

export async function getResearchArtifact(params: {
  project: ResearchProjectManifest;
  artifactId: string;
}): Promise<ResearchArtifactRecord | null> {
  const artifacts = await readArtifactIndex(params.project.workspacePath);
  return artifacts.find((artifact) => artifact.artifactId === params.artifactId) ?? null;
}

export async function buildArtifactPreview(
  artifact: ResearchArtifactRecord,
): Promise<ResearchArtifactPreview> {
  const kind = buildPreviewKind(artifact.type);
  if (kind === "image") {
    return { kind };
  }
  const excerpt = await readTextSnippet(artifact.path, 4000);
  return excerpt ? { kind, excerpt } : { kind };
}

export async function createResearchArtifactFiles(params: {
  project: ResearchProjectManifest;
  runId: string;
  files: Array<{ name: string; content: string | Buffer }>;
}): Promise<string[]> {
  await ensureResearchLayout(params.project.workspacePath);
  const runDir = resolveRunArtifactsDir(params.project.workspacePath, params.runId);
  await fs.mkdir(runDir, { recursive: true });
  const outputPaths: string[] = [];
  for (const file of params.files) {
    const target = path.join(runDir, file.name);
    await fs.writeFile(target, file.content);
    outputPaths.push(target);
  }
  return outputPaths;
}

export async function resolveArtifactFile(params: {
  project: ResearchProjectManifest;
  artifactId: string;
}): Promise<ResearchArtifactRecord | null> {
  const artifact = await getResearchArtifact(params);
  if (!artifact) {
    return null;
  }
  if (!(await pathExists(artifact.path))) {
    return {
      ...artifact,
      preview: {
        kind: buildPreviewKind(artifact.type),
        excerpt: "Artifact file is missing on disk.",
      },
    };
  }
  return {
    ...artifact,
    preview: await buildArtifactPreview(artifact),
  };
}

export function inferArtifactType(name: string): string {
  const lower = normalizeOptionalString(name)?.toLowerCase() ?? "";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".step") || lower.endsWith(".stp")) return "step";
  if (lower.endsWith(".txt")) return "txt";
  return "file";
}
