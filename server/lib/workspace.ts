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

type ResolveMode = "read" | "write" | "delete";

function readBootstrapFile(root: string, fileName: string, defaultContent: string) {
  const filePath = path.join(root, fileName);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, defaultContent, "utf8");
  }
}

function normalizeWorkspacePath(relativePath = ".") {
  if (relativePath.includes("\0")) {
    throw new Error("Workspace path cannot contain null bytes.");
  }
  if (path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath)) {
    throw new Error("Absolute paths are not allowed in the workspace.");
  }

  const parts = relativePath
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== ".");

  if (parts.some((part) => part === "..")) {
    throw new Error("Path traversal is not allowed in the workspace.");
  }

  return {
    parts,
    normalized: parts.join("/") || ".",
  };
}

function ensureDirectoryPathExists(root: string, target: string) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat || !stat.isDirectory()) {
    throw new Error("Workspace directory was not found.");
  }
  assertNoLink(stat, target);
  ensureCanonicalInside(root, target);
  return target;
}

function canonicalizeExistingPath(filePath: string) {
  return fs.realpathSync.native(filePath);
}

function ensureCanonicalInside(root: string, target: string) {
  const canonicalRoot = canonicalizeExistingPath(root);
  const canonicalTarget = canonicalizeExistingPath(target);
  const relative = path.relative(canonicalRoot, canonicalTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes the workspace boundary.");
  }
  return canonicalTarget;
}

function isUnsafeLink(stat: fs.Stats) {
  return stat.isSymbolicLink();
}

function assertNoLink(stat: fs.Stats, filePath: string) {
  if (isUnsafeLink(stat)) {
    throw new Error(`Workspace path uses an unsafe link: ${path.basename(filePath)}`);
  }
}

function walkExistingComponents(root: string, parts: string[], options: { allowMissingLeaf: boolean }) {
  let current = root;
  ensureCanonicalInside(root, root);

  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    const isLeaf = index === parts.length - 1;

    if (!stat) {
      if (options.allowMissingLeaf || isLeaf) {
        break;
      }
      break;
    }

    assertNoLink(stat, current);
    ensureCanonicalInside(root, current);
  }

  return current;
}

function resolveExistingParent(root: string, parts: string[]) {
  const parentParts = parts.slice(0, -1);
  let current = root;
  ensureCanonicalInside(root, root);

  for (const part of parentParts) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat) {
      break;
    }
    assertNoLink(stat, current);
    if (!stat.isDirectory()) {
      throw new Error("Workspace parent path is not a directory.");
    }
    ensureCanonicalInside(root, current);
  }

  return path.join(root, ...parentParts);
}

function decodeTextBuffer(filePath: string, buffer: Buffer): Omit<WorkspaceFileRecord, "scope" | "path"> {
  const extension = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension) && extension !== "") {
    return {
      content: "",
      binary: true,
      unsupportedEncoding: true,
      encoding: null,
    };
  }

  if (buffer.includes(0)) {
    return {
      content: "",
      binary: true,
      unsupportedEncoding: true,
      encoding: null,
    };
  }

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      content: buffer.subarray(3).toString("utf8"),
      binary: false,
      unsupportedEncoding: false,
      encoding: "utf-8-bom",
    };
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return {
      content: buffer.subarray(2).toString("utf16le"),
      binary: false,
      unsupportedEncoding: false,
      encoding: "utf-16le",
    };
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.alloc(buffer.length - 2);
    for (let index = 2; index < buffer.length; index += 2) {
      swapped[index - 2] = buffer[index + 1] ?? 0;
      swapped[index - 1] = buffer[index] ?? 0;
    }
    return {
      content: swapped.toString("utf16le"),
      binary: false,
      unsupportedEncoding: false,
      encoding: "utf-16be",
    };
  }

  try {
    return {
      content: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      binary: false,
      unsupportedEncoding: false,
      encoding: "utf-8",
    };
  } catch {
    return {
      content: "",
      binary: true,
      unsupportedEncoding: true,
      encoding: null,
    };
  }
}

function assertNotScopeRoot(relativePath: string, action: string) {
  if (relativePath === ".") {
    throw new Error(`Cannot ${action} the workspace scope root.`);
  }
}

export function createWorkspaceManager(
  projectRoot: string,
  options?: {
    conversationExists?: (conversationId: string) => boolean;
    conversationAgentId?: (conversationId: string) => string | null;
    enableRootScope?: boolean;
  },
) {
  const rootDir = path.join(projectRoot, "workspace");
  const sharedDir = path.join(rootDir, "shared");
  const conversationsDir = path.join(rootDir, "conversations");
  const agentsDir = path.join(rootDir, "agents");
  const enableRootScope = options?.enableRootScope ?? process.env.ENABLE_WORKSPACE_ROOT_SCOPE === "true";

  function bootstrap() {
    fs.mkdirSync(rootDir, { recursive: true });
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.mkdirSync(conversationsDir, { recursive: true });
    fs.mkdirSync(agentsDir, { recursive: true });

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
      ["# MEMORY", "", "Store durable decisions, project notes, and repeated preferences here."].join("\n"),
    );
    readBootstrapFile(
      rootDir,
      "USER.md",
      ["# USER", "", "This workspace belongs to the local user of the app."].join("\n"),
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

  function assertConversationExists(conversationId: string) {
    if (options?.conversationExists && !options.conversationExists(conversationId)) {
      throw new Error("Conversation not found.");
    }
  }

  function assertSafeEntityId(id: string, label: string) {
    if (!id || id.includes("\0") || id.includes("/") || id.includes("\\") || id.includes("..") || path.isAbsolute(id)) {
      throw new Error(`${label} id is invalid.`);
    }
  }

  function getAgentDir(agentId: string) {
    assertSafeEntityId(agentId, "Agent");
    return path.join(agentsDir, agentId);
  }

  function createAgentWorkspace(agentId: string) {
    const agentDir = getAgentDir(agentId);
    fs.mkdirSync(path.join(agentDir, "memory"), { recursive: true });
    readBootstrapFile(
      agentDir,
      "MEMORY.md",
      ["# MEMORY", "", "Durable facts, preferences, and decisions for this agent."].join("\n"),
    );
    readBootstrapFile(
      agentDir,
      "AGENTS.md",
      ["# AGENT", "", "- Keep this agent's workspace, memory, and task history isolated."].join("\n"),
    );
    return agentDir;
  }

  function deleteAgentWorkspace(agentId: string) {
    const agentDir = getAgentDir(agentId);
    const parent = canonicalizeExistingPath(agentsDir);
    const relative = path.relative(parent, path.resolve(agentDir));
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Refusing to delete workspace outside the agents directory.");
    }
    const stat = fs.lstatSync(agentDir, { throwIfNoEntry: false });
    if (!stat) {
      return false;
    }
    fs.rmSync(agentDir, {
      recursive: !stat.isSymbolicLink(),
      force: true,
    });
    return true;
  }

  function todayMemoryFileName(date = new Date()) {
    return `${date.toISOString().slice(0, 10)}.md`;
  }

  function readAgentMemory(agentId: string) {
    const agentDir = createAgentWorkspace(agentId);
    const dailyPath = path.join(agentDir, "memory", todayMemoryFileName());
    if (!fs.existsSync(dailyPath)) {
      fs.writeFileSync(dailyPath, `# ${todayMemoryFileName().replace(".md", "")}\n\n`, "utf8");
    }
    return {
      agentId,
      memory: fs.readFileSync(path.join(agentDir, "MEMORY.md"), "utf8"),
      dailyNote: fs.readFileSync(dailyPath, "utf8"),
      date: todayMemoryFileName().replace(".md", ""),
    };
  }

  function appendAgentMemory(params: {
    agentId: string;
    content: string;
    target?: "durable" | "daily";
  }) {
    const agentDir = createAgentWorkspace(params.agentId);
    const targetPath =
      params.target === "daily"
        ? path.join(agentDir, "memory", todayMemoryFileName())
        : path.join(agentDir, "MEMORY.md");
    const prefix = fs.existsSync(targetPath) && fs.readFileSync(targetPath, "utf8").trim() ? "\n\n" : "";
    fs.appendFileSync(targetPath, `${prefix}- ${params.content.trim()}\n`, "utf8");
    return readAgentMemory(params.agentId);
  }

  function searchAgentMemory(params: {
    agentId: string;
    query: string;
    maxResults?: number;
  }) {
    const agentDir = createAgentWorkspace(params.agentId);
    const query = params.query.trim().toLowerCase();
    const maxResults = params.maxResults ?? 8;
    const files = [
      path.join(agentDir, "MEMORY.md"),
      ...fs
        .readdirSync(path.join(agentDir, "memory"), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => path.join(agentDir, "memory", entry.name)),
    ];

    const results: Array<{ path: string; line: number; text: string }> = [];
    for (const filePath of files) {
      const relative = path.relative(agentDir, filePath).replace(/\\/g, "/");
      const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(query) && results.length < maxResults) {
          results.push({ path: relative, line: index + 1, text: line });
        }
      });
    }
    return results;
  }

  function getSandboxDir(conversationId: string) {
    assertConversationExists(conversationId);
    const agentId = options?.conversationAgentId?.(conversationId);
    if (agentId) {
      assertSafeEntityId(agentId, "Agent");
      return path.join(agentsDir, agentId, "sessions", conversationId);
    }
    return path.join(conversationsDir, conversationId);
  }

  function createConversationWorkspace(conversationId: string) {
    const sandboxDir = getSandboxDir(conversationId);
    fs.mkdirSync(path.join(sandboxDir, "research"), { recursive: true });
    return sandboxDir;
  }

  function getScopeRoot(conversationId: string, scope: WorkspaceScope, createSandbox = false) {
    if (scope === "shared") {
      return sharedDir;
    }
    if (scope === "root") {
      if (!enableRootScope) {
        throw new Error("Root workspace scope is disabled.");
      }
      return rootDir;
    }

    const sandboxDir = getSandboxDir(conversationId);
    if (createSandbox) {
      fs.mkdirSync(path.join(sandboxDir, "research"), { recursive: true });
    }
    return sandboxDir;
  }

  function resolvePath(params: {
    conversationId: string;
    scope: WorkspaceScope;
    relativePath?: string;
    mode?: ResolveMode;
  }) {
    const mode = params.mode ?? "read";
    const createSandbox = mode !== "read";
    const root = getScopeRoot(params.conversationId, params.scope, createSandbox);
    const { parts, normalized } = normalizeWorkspacePath(params.relativePath ?? ".");

    if (!fs.existsSync(root)) {
      if (mode === "read") {
        return {
          root,
          absolutePath: path.join(root, ...parts),
          relativePath: normalized,
        };
      }
      fs.mkdirSync(root, { recursive: true });
    }

    if (mode === "write") {
      const parent = resolveExistingParent(root, parts);
      if (parent !== root) {
        fs.mkdirSync(parent, { recursive: true });
        ensureCanonicalInside(root, parent);
      }
      const target = walkExistingComponents(root, parts, { allowMissingLeaf: true });
      return {
        root,
        absolutePath: target,
        relativePath: normalized,
      };
    }

    const target = walkExistingComponents(root, parts, { allowMissingLeaf: false });
    if (fs.existsSync(target)) {
      ensureCanonicalInside(root, target);
    }
    return {
      root,
      absolutePath: target,
      relativePath: normalized,
    };
  }

  function listTreeRecursive(root: string, rootPath: string, relativePath: string, maxDepth: number): WorkspaceTreeNode[] {
    if (maxDepth < 0) {
      return [];
    }

    const stat = fs.lstatSync(rootPath, { throwIfNoEntry: false });
    if (!stat || !stat.isDirectory()) {
      return [];
    }
    assertNoLink(stat, rootPath);
    ensureCanonicalInside(root, rootPath);

    const entries = fs
      .readdirSync(rootPath, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith(".git"))
      .sort((left, right) => left.name.localeCompare(right.name));

    const nodes: WorkspaceTreeNode[] = [];
    for (const entry of entries) {
      const entryPath = path.join(rootPath, entry.name);
      const entryStat = fs.lstatSync(entryPath, { throwIfNoEntry: false });
      if (!entryStat || isUnsafeLink(entryStat)) {
        continue;
      }
      ensureCanonicalInside(root, entryPath);

      const childRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entryStat.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: childRelativePath,
          kind: "directory",
          size: null,
          children: listTreeRecursive(root, entryPath, childRelativePath, maxDepth - 1),
        });
        continue;
      }

      if (entryStat.isFile()) {
        nodes.push({
          name: entry.name,
          path: childRelativePath,
          kind: "file",
          size: entryStat.size,
        });
      }
    }
    return nodes;
  }

  function listTree(params: {
    conversationId: string;
    scope: WorkspaceScope;
    relativePath?: string;
    maxDepth?: number;
  }) {
    const resolved = resolvePath({
      conversationId: params.conversationId,
      scope: params.scope,
      relativePath: params.relativePath ?? ".",
      mode: "read",
    });
    return listTreeRecursive(
      resolved.root,
      resolved.absolutePath,
      resolved.relativePath === "." ? "" : resolved.relativePath,
      params.maxDepth ?? 4,
    );
  }

  function readFile(params: {
    conversationId: string;
    scope: WorkspaceScope;
    relativePath: string;
  }): WorkspaceFileRecord {
    const resolved = resolvePath({
      conversationId: params.conversationId,
      scope: params.scope,
      relativePath: params.relativePath,
      mode: "read",
    });
    const stat = fs.lstatSync(resolved.absolutePath, { throwIfNoEntry: false });
    if (!stat || !stat.isFile()) {
      throw new Error("Workspace file was not found.");
    }
    assertNoLink(stat, resolved.absolutePath);
    ensureCanonicalInside(resolved.root, resolved.absolutePath);

    const payload = decodeTextBuffer(resolved.absolutePath, fs.readFileSync(resolved.absolutePath));
    return {
      scope: params.scope,
      path: resolved.relativePath,
      ...payload,
    };
  }

  function writeFile(params: {
    conversationId: string;
    scope: WorkspaceScope;
    relativePath: string;
    content: string;
  }) {
    const resolved = resolvePath({
      conversationId: params.conversationId,
      scope: params.scope,
      relativePath: params.relativePath,
      mode: "write",
    });
    assertNotScopeRoot(resolved.relativePath, "write to");
    const stat = fs.lstatSync(resolved.absolutePath, { throwIfNoEntry: false });
    if (stat) {
      assertNoLink(stat, resolved.absolutePath);
    }
    fs.writeFileSync(resolved.absolutePath, params.content, "utf8");
    ensureCanonicalInside(resolved.root, resolved.absolutePath);
    return resolved.relativePath;
  }

  function editFile(params: {
    conversationId: string;
    scope: WorkspaceScope;
    relativePath: string;
    find: string;
    replace: string;
    replaceAll?: boolean;
  }) {
    const current = readFile(params);
    if (current.binary || current.unsupportedEncoding) {
      throw new Error("Unsupported or binary files cannot be edited with edit_file.");
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
    return writeFile({
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
    const resolved = resolvePath({
      conversationId: params.conversationId,
      scope: params.scope,
      relativePath: params.relativePath,
      mode: "write",
    });
    assertNotScopeRoot(resolved.relativePath, "create");
    fs.mkdirSync(resolved.absolutePath, { recursive: true });
    ensureCanonicalInside(resolved.root, resolved.absolutePath);
    return resolved.relativePath;
  }

  function movePath(params: {
    conversationId: string;
    scope: WorkspaceScope;
    from: string;
    to: string;
  }) {
    const from = resolvePath({
      conversationId: params.conversationId,
      scope: params.scope,
      relativePath: params.from,
      mode: "delete",
    });
    const to = resolvePath({
      conversationId: params.conversationId,
      scope: params.scope,
      relativePath: params.to,
      mode: "write",
    });
    assertNotScopeRoot(from.relativePath, "move");
    assertNotScopeRoot(to.relativePath, "move to");

    const fromStat = fs.lstatSync(from.absolutePath, { throwIfNoEntry: false });
    if (!fromStat) {
      throw new Error("Workspace source path was not found.");
    }
    assertNoLink(fromStat, from.absolutePath);

    const toStat = fs.lstatSync(to.absolutePath, { throwIfNoEntry: false });
    if (toStat) {
      assertNoLink(toStat, to.absolutePath);
    }
    fs.renameSync(from.absolutePath, to.absolutePath);
    ensureCanonicalInside(to.root, to.absolutePath);
    return to.relativePath;
  }

  function deletePath(params: {
    conversationId: string;
    scope: WorkspaceScope;
    relativePath: string;
    recursive?: boolean;
  }) {
    const resolved = resolvePath({
      conversationId: params.conversationId,
      scope: params.scope,
      relativePath: params.relativePath,
      mode: "delete",
    });
    assertNotScopeRoot(resolved.relativePath, "delete");
    const stat = fs.lstatSync(resolved.absolutePath, { throwIfNoEntry: false });
    if (!stat) {
      return;
    }
    assertNoLink(stat, resolved.absolutePath);
    fs.rmSync(resolved.absolutePath, {
      recursive: Boolean(params.recursive),
      force: true,
    });
  }

  function deleteConversationWorkspace(conversationId: string) {
    const sandboxDir = getSandboxDir(conversationId);
    const parent = canonicalizeExistingPath(path.dirname(sandboxDir));
    const relative = path.relative(parent, path.resolve(sandboxDir));
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Refusing to delete workspace outside the session directory.");
    }
    const stat = fs.lstatSync(sandboxDir, { throwIfNoEntry: false });
    if (!stat) {
      return false;
    }
    fs.rmSync(sandboxDir, {
      recursive: !stat.isSymbolicLink(),
      force: true,
    });
    return true;
  }

  function resolveSandboxDirectory(params: {
    conversationId: string;
    relativePath?: string;
  }) {
    const resolved = resolvePath({
      conversationId: params.conversationId,
      scope: "sandbox",
      relativePath: params.relativePath ?? ".",
      mode: "read",
    });

    return {
      root: resolved.root,
      absolutePath: ensureDirectoryPathExists(resolved.root, resolved.absolutePath),
      relativePath: resolved.relativePath,
    };
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
    agentsDir,
    bootstrap,
    createConversationWorkspace,
    deleteConversationWorkspace,
    createAgentWorkspace,
    deleteAgentWorkspace,
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
    resolveSandboxDirectory,
    readAgentMemory,
    appendAgentMemory,
    searchAgentMemory,
    readGuides,
  };
}
