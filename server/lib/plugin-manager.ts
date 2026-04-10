import fs from "node:fs";
import path from "node:path";
import { createToolRegistry } from "./tool-registry.js";
import type { AgentRecord } from "../types.js";

export interface LoadedSkill {
  id: string;
  name: string;
  source: "agent" | "shared" | "plugin";
  content: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  skills?: Array<{
    name: string;
    content?: string;
    file?: string;
  }>;
}

export interface RegisteredPlugin {
  manifest: PluginManifest;
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
        content: fs.readFileSync(fullPath, "utf8"),
      } satisfies LoadedSkill;
    });
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
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PluginManifest;
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
    loadSkills,
    getPlanningSkillBlock,
  };
}
