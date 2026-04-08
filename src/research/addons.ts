import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import { readJsonFile, writeJsonFile } from "./fs.js";
import { resolveProjectManifestPath, resolveWorkspaceRoot } from "./paths.js";
import type {
  ResearchAddonDefinition,
  ResearchAddonId,
  ResearchAddonStatus,
  ResearchProjectManifest,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

export const RESEARCH_ADDONS: readonly ResearchAddonDefinition[] = [
  {
    id: "mock_cfd",
    name: "Mock CFD",
    version: "0.1.0",
    description: "Creates demo CFD cases and a task-backed mock solver run.",
    tools: ["mock_cfd.create_cfd_case", "mock_cfd.run_mock_solver"],
    permissions: ["workspace.write", "artifacts.write", "tasks.create"],
    skillDirName: "research-mock-cfd",
    isMock: true,
  },
  {
    id: "mock_concept",
    name: "Mock Concept",
    version: "0.1.0",
    description: "Generates conceptual tradeoff studies for early aerospace design work.",
    tools: ["mock_concept.generate_concept_tradeoff"],
    permissions: ["workspace.write", "artifacts.write"],
    skillDirName: "research-mock-concept",
    isMock: true,
  },
  {
    id: "mock_cad",
    name: "Mock CAD",
    version: "0.1.0",
    description: "Builds placeholder CAD-style geometry outputs and previews.",
    tools: ["mock_cad.build_mock_geometry"],
    permissions: ["workspace.write", "artifacts.write"],
    skillDirName: "research-mock-cad",
    isMock: true,
  },
] as const;

const RESEARCH_ADDON_IDS = new Set<string>(RESEARCH_ADDONS.map((addon) => addon.id));

function normalizeAddonIds(value: unknown): ResearchAddonId[] {
  if (!Array.isArray(value)) {
    return RESEARCH_ADDONS.map((addon) => addon.id);
  }
  const ids = value
    .map((entry) => normalizeOptionalString(entry))
    .filter((entry): entry is ResearchAddonId => Boolean(entry && RESEARCH_ADDON_IDS.has(entry)));
  return ids.length > 0 ? ids : RESEARCH_ADDONS.map((addon) => addon.id);
}

export function isResearchAddonId(value: string): value is ResearchAddonId {
  return RESEARCH_ADDON_IDS.has(value as ResearchAddonId);
}

export function getResearchAddonDefinition(addonId: ResearchAddonId): ResearchAddonDefinition {
  const addon = RESEARCH_ADDONS.find((entry) => entry.id === addonId);
  if (!addon) {
    throw new Error(`Unknown research add-on: ${addonId}`);
  }
  return addon;
}

export function getEnabledResearchAddonIds(
  manifest: Pick<ResearchProjectManifest, "enabledAddons">,
): ResearchAddonId[] {
  return normalizeAddonIds(manifest.enabledAddons);
}

export function buildResearchAddonStatuses(
  manifest: Pick<ResearchProjectManifest, "enabledAddons">,
): ResearchAddonStatus[] {
  const enabledIds = new Set(getEnabledResearchAddonIds(manifest));
  return RESEARCH_ADDONS.map((addon) => ({
    ...addon,
    enabled: enabledIds.has(addon.id),
    health: enabledIds.has(addon.id) ? "ready" : "disabled",
  }));
}

async function copySkillDirectory(params: {
  sourceDir: string;
  targetDir: string;
}): Promise<void> {
  await fs.rm(params.targetDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(params.targetDir), { recursive: true });
  await fs.cp(params.sourceDir, params.targetDir, {
    recursive: true,
    force: true,
    filter: (input) => {
      const name = path.basename(input);
      return name !== ".git" && name !== "node_modules";
    },
  });
}

export async function syncResearchSkillsToWorkspace(
  workspaceDir: string,
  enabledAddonIds: ResearchAddonId[],
): Promise<void> {
  const workspaceRoot = await resolveWorkspaceRoot(workspaceDir);
  const targetSkillsDir = path.join(workspaceRoot, "skills");
  await fs.mkdir(targetSkillsDir, { recursive: true });
  const enabled = new Set(enabledAddonIds);

  for (const addon of RESEARCH_ADDONS) {
    const sourceDir = path.join(REPO_ROOT, "skills", addon.skillDirName);
    const targetDir = path.join(targetSkillsDir, addon.skillDirName);
    if (!enabled.has(addon.id)) {
      await fs.rm(targetDir, { recursive: true, force: true });
      continue;
    }
    await copySkillDirectory({ sourceDir, targetDir });
  }
}

export async function updateProjectAddonState(params: {
  workspaceDir: string;
  addonId: ResearchAddonId;
  enabled: boolean;
}): Promise<ResearchProjectManifest> {
  const manifestPath = resolveProjectManifestPath(params.workspaceDir);
  const manifest = await readJsonFile<ResearchProjectManifest | null>(manifestPath, null);
  if (!manifest) {
    throw new Error("Project manifest not found");
  }
  const enabledIds = new Set(getEnabledResearchAddonIds(manifest));
  if (params.enabled) {
    enabledIds.add(params.addonId);
  } else {
    enabledIds.delete(params.addonId);
  }
  const nextManifest: ResearchProjectManifest = {
    ...manifest,
    enabledAddons: RESEARCH_ADDONS.map((addon) => addon.id).filter((addonId) =>
      enabledIds.has(addonId),
    ),
    updatedAt: Date.now(),
  };
  await writeJsonFile(manifestPath, nextManifest);
  await syncResearchSkillsToWorkspace(
    params.workspaceDir,
    getEnabledResearchAddonIds(nextManifest),
  );
  return nextManifest;
}

export async function readProjectManifestFromWorkspace(
  workspaceDir: string,
): Promise<ResearchProjectManifest | null> {
  const manifest = await readJsonFile<ResearchProjectManifest | null>(
    resolveProjectManifestPath(workspaceDir),
    null,
  );
  if (!manifest) {
    return null;
  }
  return {
    ...manifest,
    enabledAddons: normalizeAddonIds(manifest.enabledAddons),
  };
}
