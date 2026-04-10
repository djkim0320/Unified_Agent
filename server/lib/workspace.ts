import fs from "node:fs";
import path from "node:path";
import type { WorkspaceFileRecord, WorkspaceScope, WorkspaceTreeNode } from "../types.js";

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".json5",
  ".yaml",
  ".yml",
  ".toml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".html",
  ".xml",
  ".csv",
  ".sql",
  ".sh",
  ".ps1",
  ".bat",
  ".env",
]);

function ensureInside(root: string, target: string) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    normalizedTarget === path.parse(normalizedTarget).root
  ) {
    throw new Error("Path escapes the workspace boundary.");
  }
  return normalizedTarget;
}

function readBootstrapFile(root: string, fileName: string, defaultContent: string) {
  const filePath = path.join(root, fileName);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, defaultContent, "utf8");
  }
}

export function createWorkspaceManager(projectRoot: string) {
  const rootDir = path.join(projectRoot, "workspace");
  const sharedDir = path.join(rootDir, "shared");
  const conversationsDir = path.join(rootDir, "conversations");

  function bootstrap() {
    fs.mkdirSync(rootDir, { recursive: true });
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.mkdirSync(conversationsDir, { recursive: true });

    readBootstrapFile(
      rootDir,
      "AGENTS.md",
      [
        "# AGENTS",
        "",
        "- Work only inside this workspace unless explicitly told otherwise.",
        "- Prefer small, well-documented changes.",
        "- Write research notes into the conversation research folder when useful.",
      ].join("\n"),
    );
    readBootstrapFile(
      rootDir,
      "MEMORY.md",
      [
        "# MEMORY",
        "",
        "Store durable decisions, project notes, and repeated preferences here.",
      ].join("\n"),
    );
    readBootstrapFile(
      rootDir,
      "USER.md",
      [
        "# USER",
        "",
        "This workspace belongs to the local user of the app.",
      ].join("\n"),
    );
    readBootstrapFile(
      rootDir,
      "TOOLS.md",
      [
        "# TOOLS",
        "",
        "- File tools operate within the workspace boundary.",
        "- Command execution runs in the current conversation sandbox.",
        "- Browser research can search, open, and extract pages.",
      ].join("\n"),
    );
  }

  function getSandboxDir(conversationId: string) {
    const sandboxDir = path.join(conversationsDir, conversationId);
    fs.mkdirSync(sandboxDir, { recursive: true });
    fs.mkdirSync(path.join(sandboxDir, "research"), { recursive: true });
    return sandboxDir;
  }

  function getScopeRoot(conversationId: string, scope: WorkspaceScope) {
    if (scope === "shared") {
      fs.mkdirSync(sharedDir, { recursive: true });
      return sharedDir;
    }
    if (scope === "root") {
      return rootDir;
    }
    return getSandboxDir(conversationId);
  }

  function resolvePath(conversationId: string, scope: WorkspaceScope, relativePath = ".") {
    const scopeRoot = getScopeRoot(conversationId, scope);
    return ensureInside(scopeRoot, path.join(scopeRoot, relativePath));
  }

  function readTextFile(filePath: string) {
    const extension = path.extname(filePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension) && extension !== "") {
      return {
        content: "",
        binary: true,
      };
    }
    return {
      content: fs.readFileSync(filePath, "utf8"),
      binary: false,
    };
  }

  function listTreeRecursive(rootPath: string, relativePath: string, maxDepth: number): WorkspaceTreeNode[] {
    if (maxDepth < 0) {
      return [];
    }

    const entries = fs
      .readdirSync(rootPath, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith(".git"))
      .sort((left, right) => left.name.localeCompare(right.name));

    return entries.map((entry) => {
      const entryPath = path.join(rootPath, entry.name);
      const childRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        return {
          name: entry.name,
          path: childRelativePath,
          kind: "directory",
          size: null,
          children: listTreeRecursive(entryPath, childRelativePath, maxDepth - 1),
        } satisfies WorkspaceTreeNode;
      }

      return {
        name: entry.name,
        path: childRelativePath,
        kind: "file",
        size: fs.statSync(entryPath).size,
      } satisfies WorkspaceTreeNode;
    });
  }

  function listTree(params: {
    conversationId: string;
    scope: WorkspaceScope;
    relativePath?: string;
    maxDepth?: number;
  }) {
    const absolutePath = resolvePath(
      params.conversationId,
      params.scope,
      params.relativePath ?? ".",
    );
    return listTreeRecursive(
      absolutePath,
      params.relativePath?.replace(/\\/g, "/").replace(/^\.$/, "") ?? "",
      params.maxDepth ?? 4,
    );
  }

  function readFile(params: {
    conversationId: string;
    scope: WorkspaceScope;
    relativePath: string;
  }): WorkspaceFileRecord {
    const absolutePath = resolvePath(params.conversationId, params.scope, params.relativePath);
    const stat = fs.statSync(absolutePath, { throwIfNoEntry: false });
    if (!stat || !stat.isFile()) {
      throw new Error("Workspace file was not found.");
    }

    const payload = readTextFile(absolutePath);
    return {
      scope: params.scope,
      path: params.relativePath.replace(/\\/g, "/"),
      absolutePath,
      content: payload.content,
      binary: payload.binary,
    };
  }

  function writeFile(params: {
    conversationId: string;
    scope: WorkspaceScope;
    relativePath: string;
    content: string;
  }) {
    const absolutePath = resolvePath(params.conversationId, params.scope, params.relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, params.content, "utf8");
    return absolutePath;
  }

  function editFile(params: {
    conversationId: string;
    scope: WorkspaceScope;
    relativePath: string;
    find: string;
    replace: string;
    replaceAll?: boolean;
  }) {
    const current = readFile({
      conversationId: params.conversationId,
      scope: params.scope,
      relativePath: params.relativePath,
    });
    if (current.binary) {
      throw new Error("Binary files cannot be edited with edit_file.");
    }
    if (!params.find) {
      throw new Error("edit_file requires a non-empty find string.");
    }
    if (!current.content.includes(params.find)) {
      throw new Error("edit_file could not find the target text.");
    }

    const nextContent = params.replaceAll
      ? current.content.split(params.find).join(params.replace)
      : current.content.replace(params.find, params.replace);
    writeFile({
      conversationId: params.conversationId,
      scope: params.scope,
      relativePath: params.relativePath,
      content: nextContent,
    });
  }

  function makeDir(params: {
    conversationId: string;
    scope: WorkspaceScope;
    relativePath: string;
  }) {
    const absolutePath = resolvePath(params.conversationId, params.scope, params.relativePath);
    fs.mkdirSync(absolutePath, { recursive: true });
    return absolutePath;
  }

  function movePath(params: {
    conversationId: string;
    scope: WorkspaceScope;
    from: string;
    to: string;
  }) {
    const fromPath = resolvePath(params.conversationId, params.scope, params.from);
    const toPath = resolvePath(params.conversationId, params.scope, params.to);
    fs.mkdirSync(path.dirname(toPath), { recursive: true });
    fs.renameSync(fromPath, toPath);
    return toPath;
  }

  function deletePath(params: {
    conversationId: string;
    scope: WorkspaceScope;
    relativePath: string;
    recursive?: boolean;
  }) {
    const absolutePath = resolvePath(params.conversationId, params.scope, params.relativePath);
    fs.rmSync(absolutePath, {
      recursive: Boolean(params.recursive),
      force: true,
    });
  }

  function readGuides() {
    return {
      agents: fs.readFileSync(path.join(rootDir, "AGENTS.md"), "utf8"),
      memory: fs.readFileSync(path.join(rootDir, "MEMORY.md"), "utf8"),
      user: fs.readFileSync(path.join(rootDir, "USER.md"), "utf8"),
      tools: fs.readFileSync(path.join(rootDir, "TOOLS.md"), "utf8"),
    };
  }

  bootstrap();

  return {
    rootDir,
    sharedDir,
    conversationsDir,
    bootstrap,
    getSandboxDir,
    getScopeRoot,
    resolvePath,
    listTree,
    readFile,
    writeFile,
    editFile,
    makeDir,
    movePath,
    deletePath,
    readGuides,
  };
}

