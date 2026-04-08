import { t } from "../i18n/index.ts";
import type { IconName } from "./icons.js";
import { normalizeLowercaseStringOrEmpty } from "./string-coerce.ts";

export const TAB_GROUPS = [
  {
    label: "workspace",
    tabs: ["overview", "chat", "runs", "artifacts", "addons", "settings", "advanced"],
  },
  {
    label: "legacy",
    tabs: ["channels", "instances", "sessions", "usage", "cron", "agents", "skills", "nodes", "dreams"],
  },
  {
    label: "system",
    tabs: [
      "config",
      "communications",
      "appearance",
      "automation",
      "infrastructure",
      "aiAgents",
      "debug",
      "logs",
    ],
  },
] as const;

export const RESEARCH_TABS = [
  "overview",
  "chat",
  "runs",
  "artifacts",
  "addons",
  "settings",
  "advanced",
] as const satisfies readonly Tab[];

export const LEGACY_TABS = [
  "agents",
  "channels",
  "instances",
  "sessions",
  "usage",
  "cron",
  "skills",
  "nodes",
  "config",
  "communications",
  "appearance",
  "automation",
  "infrastructure",
  "aiAgents",
  "debug",
  "logs",
  "dreams",
] as const satisfies readonly Tab[];

export type Tab =
  | "agents"
  | "overview"
  | "runs"
  | "artifacts"
  | "addons"
  | "settings"
  | "advanced"
  | "channels"
  | "instances"
  | "sessions"
  | "usage"
  | "cron"
  | "skills"
  | "nodes"
  | "chat"
  | "config"
  | "communications"
  | "appearance"
  | "automation"
  | "infrastructure"
  | "aiAgents"
  | "debug"
  | "logs"
  | "dreams";

const TAB_PATHS: Record<Tab, string> = {
  agents: "/agents",
  overview: "/overview",
  runs: "/runs",
  artifacts: "/artifacts",
  addons: "/addons",
  settings: "/settings",
  advanced: "/advanced",
  channels: "/channels",
  instances: "/instances",
  sessions: "/sessions",
  usage: "/usage",
  cron: "/cron",
  skills: "/skills",
  nodes: "/nodes",
  chat: "/chat",
  config: "/config",
  communications: "/communications",
  appearance: "/appearance",
  automation: "/automation",
  infrastructure: "/infrastructure",
  aiAgents: "/ai-agents",
  debug: "/debug",
  logs: "/logs",
  dreams: "/dreaming",
};

const PATH_ALIASES: Record<string, Tab> = {
  "/dreams": "dreams",
};

const PATH_TO_TAB = new Map<string, Tab>([
  ...Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as Tab] as const),
  ...Object.entries(PATH_ALIASES),
]);

export function normalizeBasePath(basePath: string): string {
  if (!basePath) {
    return "";
  }
  let base = basePath.trim();
  if (!base.startsWith("/")) {
    base = `/${base}`;
  }
  if (base === "/") {
    return "";
  }
  if (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  return base;
}

export function normalizePath(path: string): string {
  if (!path) {
    return "/";
  }
  let normalized = path.trim();
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function pathForTab(tab: Tab, basePath = ""): string {
  const base = normalizeBasePath(basePath);
  const path = TAB_PATHS[tab];
  return base ? `${base}${path}` : path;
}

export function tabFromPath(pathname: string, basePath = ""): Tab | null {
  const base = normalizeBasePath(basePath);
  let path = pathname || "/";
  if (base) {
    if (path === base) {
      path = "/";
    } else if (path.startsWith(`${base}/`)) {
      path = path.slice(base.length);
    }
  }
  let normalized = normalizeLowercaseStringOrEmpty(normalizePath(path));
  if (normalized.endsWith("/index.html")) {
    normalized = "/";
  }
  if (normalized === "/") {
    return "overview";
  }
  return PATH_TO_TAB.get(normalized) ?? null;
}

export function inferBasePathFromPathname(pathname: string): string {
  let normalized = normalizePath(pathname);
  if (normalized.endsWith("/index.html")) {
    normalized = normalizePath(normalized.slice(0, -"/index.html".length));
  }
  if (normalized === "/") {
    return "";
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "";
  }
  for (let i = 0; i < segments.length; i++) {
    const candidate = normalizeLowercaseStringOrEmpty(`/${segments.slice(i).join("/")}`);
    if (PATH_TO_TAB.has(candidate)) {
      const prefix = segments.slice(0, i);
      return prefix.length ? `/${prefix.join("/")}` : "";
    }
  }
  return `/${segments.join("/")}`;
}

export function iconForTab(tab: Tab): IconName {
  switch (tab) {
    case "agents":
      return "folder";
    case "runs":
      return "loader";
    case "artifacts":
      return "fileText";
    case "addons":
      return "zap";
    case "settings":
      return "settings";
    case "advanced":
      return "bug";
    case "chat":
      return "messageSquare";
    case "overview":
      return "barChart";
    case "channels":
      return "link";
    case "instances":
      return "radio";
    case "sessions":
      return "fileText";
    case "usage":
      return "barChart";
    case "cron":
      return "loader";
    case "skills":
      return "zap";
    case "nodes":
      return "monitor";
    case "config":
      return "settings";
    case "communications":
      return "send";
    case "appearance":
      return "spark";
    case "automation":
      return "terminal";
    case "infrastructure":
      return "globe";
    case "aiAgents":
      return "brain";
    case "debug":
      return "bug";
    case "logs":
      return "scrollText";
    case "dreams":
      return "moon";
    default:
      return "folder";
  }
}

export function titleForTab(tab: Tab) {
  if (tab === "runs") return "Runs";
  if (tab === "artifacts") return "Artifacts";
  if (tab === "addons") return "Add-ons";
  if (tab === "settings") return "Settings";
  if (tab === "advanced") return "Advanced";
  return t(`tabs.${tab}`);
}

export function subtitleForTab(tab: Tab) {
  if (tab === "overview") return "Research overview";
  if (tab === "chat") return "Project chat and quick interventions";
  if (tab === "runs") return "Task-backed research runs";
  if (tab === "artifacts") return "Generated outputs";
  if (tab === "addons") return "Research add-ons";
  if (tab === "settings") return "Project configuration";
  if (tab === "advanced") return "Legacy operator tools";
  return t(`subtitles.${tab}`);
}

export function isResearchTab(tab: Tab): tab is (typeof RESEARCH_TABS)[number] {
  return (RESEARCH_TABS as readonly string[]).includes(tab);
}
