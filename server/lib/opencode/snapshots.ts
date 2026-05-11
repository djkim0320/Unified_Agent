import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function parsePositiveIntegerEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const MAX_ARTIFACT_SNAPSHOT_BYTES = parsePositiveIntegerEnv("AETHEROPS_MAX_ARTIFACT_SNAPSHOT_BYTES", 64 * 1024);
const MAX_SNAPSHOT_FILES = parsePositiveIntegerEnv("AETHEROPS_MAX_SNAPSHOT_FILES", 10_000);
const MAX_SNAPSHOT_TOTAL_BYTES = parsePositiveIntegerEnv("AETHEROPS_MAX_SNAPSHOT_TOTAL_BYTES", 256 * 1024 * 1024);

const SNAPSHOT_SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".data",
  "node_modules",
  ".opencode",
  ".aetherops-tmp",
  "workspace",
  "dist",
  "build",
  ".vite",
  "coverage",
]);

const SNAPSHOT_SKIP_FILES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  "local-api.token",
  "secret.key",
]);

export type SnapshotEntry = {
  size: number;
  mtimeMs: number;
  hash: string | null;
  textContent: string | null;
  binary: boolean;
  truncated: boolean;
  encoding: string | null;
  unsupportedEncoding: boolean;
  metadata: Record<string, unknown>;
};

export type WorkspaceSnapshot = {
  files: Map<string, SnapshotEntry>;
  degraded: boolean;
  degradationReasons: string[];
  fileCount: number;
  totalBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
  baselineDir: string | null;
  durationMs: number;
};

function metadataOnlyEntry(stat: fs.Stats): SnapshotEntry {
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    hash: null,
    textContent: null,
    binary: false,
    truncated: false,
    encoding: null,
    unsupportedEncoding: false,
    metadata: {
      snapshotMode: "metadata-only",
      snapshotLimitBytes: MAX_ARTIFACT_SNAPSHOT_BYTES,
    },
  };
}

function hashFileStreaming(absolutePath: string) {
  const hash = crypto.createHash("sha256");
  const fileHandle = fs.openSync(absolutePath, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fileHandle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fileHandle);
  }
  return hash.digest("hex");
}

function readFilePrefix(absolutePath: string, bytesToRead: number) {
  if (bytesToRead <= 0) {
    return Buffer.alloc(0);
  }
  const buffer = Buffer.alloc(bytesToRead);
  const fileHandle = fs.openSync(absolutePath, "r");
  try {
    const read = fs.readSync(fileHandle, buffer, 0, bytesToRead, 0);
    return read === buffer.length ? buffer : buffer.subarray(0, read);
  } finally {
    fs.closeSync(fileHandle);
  }
}

function captureSnapshotEntry(absolutePath: string, size: number): Omit<SnapshotEntry, "size" | "mtimeMs"> {
  const truncated = size > MAX_ARTIFACT_SNAPSHOT_BYTES;
  const bytesToRead = Math.min(size, MAX_ARTIFACT_SNAPSHOT_BYTES);
  const buffer = readFilePrefix(absolutePath, bytesToRead);
  const binary = buffer.includes(0);
  const hash = hashFileStreaming(absolutePath);
  const metadata = {
    snapshotLimitBytes: MAX_ARTIFACT_SNAPSHOT_BYTES,
    hashStrategy: "streaming-sha256",
    snapshotMode: "changed-file-capture",
  };
  if (binary || truncated) {
    return {
      hash,
      textContent: null,
      binary,
      truncated,
      encoding: binary ? null : "utf8",
      unsupportedEncoding: false,
      metadata,
    };
  }
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return {
      hash,
      textContent: decoder.decode(buffer),
      binary: false,
      truncated: false,
      encoding: "utf8",
      unsupportedEncoding: false,
      metadata,
    };
  } catch {
    return {
      hash,
      textContent: null,
      binary: false,
      truncated: false,
      encoding: "unsupported-utf8",
      unsupportedEncoding: true,
      metadata,
    };
  }
}

function copyBaselineFile(sourcePath: string, baselineDir: string, relativePath: string, size: number) {
  if (size > MAX_ARTIFACT_SNAPSHOT_BYTES) {
    return;
  }
  const targetPath = path.join(baselineDir, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

export function snapshotWorkspace(root: string, options: { createBaseline?: boolean } = {}): WorkspaceSnapshot {
  const startedAt = Date.now();
  const snapshot: WorkspaceSnapshot = {
    files: new Map<string, SnapshotEntry>(),
    degraded: false,
    degradationReasons: [],
    fileCount: 0,
    totalBytes: 0,
    maxFiles: MAX_SNAPSHOT_FILES,
    maxTotalBytes: MAX_SNAPSHOT_TOTAL_BYTES,
    baselineDir: options.createBaseline ? fs.mkdtempSync(path.join(os.tmpdir(), "aetherops-snapshot-")) : null,
    durationMs: 0,
  };

  const markDegraded = (reason: string) => {
    snapshot.degraded = true;
    if (!snapshot.degradationReasons.includes(reason)) {
      snapshot.degradationReasons.push(reason);
    }
  };

  const visit = (directory: string, relativeBase: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (SNAPSHOT_SKIP_DIRS.has(entry.name)) {
        continue;
      }
      if (SNAPSHOT_SKIP_FILES.has(entry.name)) {
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.posix.join(relativeBase, entry.name);
      const stat = fs.lstatSync(absolutePath, { throwIfNoEntry: false });
      if (!stat || stat.isSymbolicLink()) {
        continue;
      }
      if (stat.isDirectory()) {
        visit(absolutePath, relativePath);
        continue;
      }
      if (!stat.isFile()) {
        continue;
      }

      snapshot.fileCount += 1;
      snapshot.totalBytes += stat.size;
      if (snapshot.fileCount > MAX_SNAPSHOT_FILES) {
        markDegraded(`file count exceeded ${MAX_SNAPSHOT_FILES}`);
        continue;
      }
      if (snapshot.totalBytes > MAX_SNAPSHOT_TOTAL_BYTES) {
        markDegraded(`total bytes exceeded ${MAX_SNAPSHOT_TOTAL_BYTES}`);
        continue;
      }

      snapshot.files.set(relativePath, metadataOnlyEntry(stat));
      if (snapshot.baselineDir) {
        copyBaselineFile(absolutePath, snapshot.baselineDir, relativePath, stat.size);
      }
    }
  };

  if (fs.existsSync(root)) {
    visit(root, "");
  }
  snapshot.durationMs = Date.now() - startedAt;
  return snapshot;
}

export function cleanupWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
  if (snapshot.baselineDir) {
    fs.rmSync(snapshot.baselineDir, { recursive: true, force: true });
    snapshot.baselineDir = null;
  }
}

export function changedFilesBetween(before: WorkspaceSnapshot, after: WorkspaceSnapshot) {
  const changed = new Set<string>();
  for (const [relativePath, entry] of after.files) {
    const previous = before.files.get(relativePath);
    if (!previous || previous.size !== entry.size || previous.mtimeMs !== entry.mtimeMs) {
      changed.add(relativePath);
    }
  }
  for (const relativePath of before.files.keys()) {
    if (!after.files.has(relativePath)) {
      changed.add(relativePath);
    }
  }
  return [...changed].sort();
}

function captureChangedEntry(root: string, relativePath: string, metadataEntry: SnapshotEntry | null) {
  if (!metadataEntry) {
    return null;
  }
  const absolutePath = path.join(root, ...relativePath.split("/"));
  const stat = fs.lstatSync(absolutePath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
    return null;
  }
  const captured = captureSnapshotEntry(absolutePath, stat.size);
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ...captured,
  } satisfies SnapshotEntry;
}

export function artifactSnapshotsForChangedFiles(
  workspaceRoot: string,
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
  changedFiles: string[],
) {
  const degraded = before.degraded || after.degraded;
  return changedFiles.map((relativePath) => {
    const beforeEntry = before.baselineDir
      ? captureChangedEntry(before.baselineDir, relativePath, before.files.get(relativePath) ?? null)
      : null;
    const afterEntry = captureChangedEntry(workspaceRoot, relativePath, after.files.get(relativePath) ?? null);
    const metadata = {
      ...(afterEntry?.metadata ?? beforeEntry?.metadata ?? {}),
      snapshotDegraded: degraded,
      degradationReasons: [...before.degradationReasons, ...after.degradationReasons],
      beforeMetadataOnly: !beforeEntry && before.files.has(relativePath),
    };
    return {
      path: relativePath,
      beforeContent: beforeEntry?.textContent ?? null,
      afterContent: afterEntry?.textContent ?? null,
      beforeHash: beforeEntry?.hash ?? null,
      afterHash: afterEntry?.hash ?? null,
      sizeBytes: afterEntry?.size ?? beforeEntry?.size ?? before.files.get(relativePath)?.size ?? null,
      encoding: afterEntry?.encoding ?? beforeEntry?.encoding ?? null,
      binary: Boolean(afterEntry?.binary ?? beforeEntry?.binary ?? false),
      truncated: Boolean(afterEntry?.truncated ?? beforeEntry?.truncated ?? false),
      unsupportedEncoding: Boolean(afterEntry?.unsupportedEncoding ?? beforeEntry?.unsupportedEncoding ?? false),
      metadata,
    };
  });
}
