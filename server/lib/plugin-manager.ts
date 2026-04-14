import fs from "node:fs";
import path from "node:path";
import { createToolRegistry } from "./tool-registry.js";
import type {
  AgentRecord,
  AgentSkillSummary,
  PluginManifest,
  PluginSkillSummary,
  ToolName,
} from "../types.js";

export interface LoadedSkill {
  id: string;
  name: string;
  source: "agent" | "shared" | "plugin";
  pluginId: string | null;
  content: string;
}

export interface PluginSkillDefinition {
  name: string;
  content?: string;
  file?: string;
}

export interface PluginDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  tools: ToolName[];
  skills?: PluginSkillDefinition[];
}

export interface RegisteredPlugin {
  manifest: PluginDefinition;
}

function readMarkdownFiles(directory: string, source: LoadedSkill["source"]) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => {
          const fullPath = path.join(directory, entry.name);
          return {
            id: `${source}:${entry.name}`,
            name: entry.name.replace(/\.md$/i, ""),
            source,
            pluginId: null,
            content: fs.readFileSync(fullPath, "utf8"),
          } satisfies LoadedSkill;
        });
}

function summarizeContent(content: string) {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  const firstBlock = normalized.split(/\n\s*\n/)[0]?.trim() ?? normalized;
  const firstLine = firstBlock.split("\n")[0]?.replace(/^#+\s*/, "").trim() ?? "";
  const collapsed = (firstLine || firstBlock).replace(/\s+/g, " ");
  if (!collapsed) {
    return null;
  }
  return collapsed.length > 180 ? `${collapsed.slice(0, 177)}...` : collapsed;
}

function normalizePluginDefinition(manifest: Partial<PluginDefinition> & { id: string; name: string; version: string }): PluginDefinition {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: typeof manifest.description === "string" ? manifest.description : "",
    tools: Array.isArray(manifest.tools)
      ? manifest.tools.filter((tool): tool is ToolName => typeof tool === "string" && tool.length > 0)
      : [],
    skills: Array.isArray(manifest.skills)
      ? manifest.skills
          .filter((skill): skill is PluginSkillDefinition => Boolean(skill && typeof skill.name === "string"))
          .map((skill) => ({
            name: skill.name,
            content: typeof skill.content === "string" ? skill.content : undefined,
            file: typeof skill.file === "string" ? skill.file : undefined,
          }))
      : [],
  };
}

export function createPluginManager(params: {
  projectRoot: string;
  builtInPlugins?: RegisteredPlugin[];
}) {
  const toolRegistry = createToolRegistry();
  const sharedSkillDir = path.join(params.projectRoot, "workspace", "shared", "skills");
  const sharedPluginDir = path.join(params.projectRoot, "workspace", "shared", "plugins");
  fs.mkdirSync(sharedSkillDir, { recursive: true });
  fs.mkdirSync(sharedPluginDir, { recursive: true });

  function loadLocalPluginManifests() {
    if (!fs.existsSync(sharedPluginDir)) {
      return [];
    }

    const manifests: RegisteredPlugin[] = [];
    for (const entry of fs.readdirSync(sharedPluginDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const manifestPath = path.join(sharedPluginDir, entry.name, "plugin.json");
      if (!fs.existsSync(manifestPath)) {
        continue;
      }
      try {
        const manifest = normalizePluginDefinition(
          JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Partial<PluginDefinition> & {
            id: string;
            name: string;
            version: string;
          },
        );
        manifests.push({ manifest });
      } catch {
        // Ignore invalid local manifests so a broken plugin cannot break the whole app.
      }
    }
    return manifests;
  }

  function listPlugins() {
    return [...(params.builtInPlugins ?? []), ...loadLocalPluginManifests()];
  }

  function listPluginSummaries() {
    return listPlugins().map((plugin) => ({
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      description: plugin.manifest.description,
      tools: [...plugin.manifest.tools],
      skills: (plugin.manifest.skills ?? [])
        .map((skill): PluginSkillSummary | null => {
          const content = skill.content ?? (skill.file
            ? (() => {
                const candidatePath = path.join(sharedPluginDir, plugin.manifest.id, skill.file);
                return fs.existsSync(candidatePath) ? fs.readFileSync(candidatePath, "utf8") : null;
              })()
            : null);
          if (!content) {
            return null;
          }
          return {
            name: skill.name,
            summary: summarizeContent(content),
          };
        })
        .filter((skill): skill is PluginSkillSummary => Boolean(skill)),
    })) satisfies PluginManifest[];
  }

  function loadSkills(agent: AgentRecord) {
    const agentSkillDir = path.join(params.projectRoot, "workspace", "agents", agent.id, "skills");
    fs.mkdirSync(agentSkillDir, { recursive: true });

    const pluginSkills = listPlugins().flatMap((plugin) =>
      (plugin.manifest.skills ?? []).flatMap((skill) => {
        if (skill.content) {
          return [
            {
              id: `plugin:${plugin.manifest.id}:${skill.name}`,
              name: skill.name,
              source: "plugin" as const,
              pluginId: plugin.manifest.id,
              content: skill.content,
            },
          ];
        }
        if (!skill.file) {
          return [];
        }
        const candidatePath = path.join(sharedPluginDir, plugin.manifest.id, skill.file);
        if (!fs.existsSync(candidatePath)) {
          return [];
        }
        return [
          {
            id: `plugin:${plugin.manifest.id}:${skill.name}`,
            name: skill.name,
            source: "plugin" as const,
            pluginId: plugin.manifest.id,
            content: fs.readFileSync(candidatePath, "utf8"),
          },
        ];
      }),
    );

    return [
      ...pluginSkills,
      ...readMarkdownFiles(sharedSkillDir, "shared"),
      ...readMarkdownFiles(agentSkillDir, "agent"),
    ];
  }

  function listSkillSummaries(agent: AgentRecord): AgentSkillSummary[] {
    return loadSkills(agent).map((skill) => ({
      id: skill.id,
      name: skill.name,
      source: skill.source,
      pluginId: skill.pluginId,
      summary: summarizeContent(skill.content) ?? "No summary available.",
    }));
  }

  function getPlanningSkillBlock(agent: AgentRecord) {
    const skills = loadSkills(agent);
    if (!skills.length) {
      return "No extra skill guidance is loaded.";
    }
    return skills
      .map((skill) => `## ${skill.name} (${skill.source})\n${skill.content.trim()}`)
      .join("\n\n");
  }

  return {
    toolRegistry,
    sharedSkillDir,
    sharedPluginDir,
    listPlugins,
    listPluginSummaries,
    loadSkills,
    listSkillSummaries,
    getPlanningSkillBlock,
  };
}
