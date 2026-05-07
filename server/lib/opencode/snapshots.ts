import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function parsePositiveIntegerEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const MAX_ARTIFACT_SNAPSHOT_BYTES = parsePositiveIntegerEnv("AETHEROPS_MAX_ARTIFACT_SNAPSHOT_BYTES", 64 * 1024);
const SNAPSHOT_SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".opencode",
  ".aetherops-tmp",
  "dist",
  "build",
  ".vite",
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

export function snapshotWorkspace(root: string) {
  const snapshot = new Map<string, SnapshotEntry>();
  const visit = (directory: string, relativeBase: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (SNAPSHOT_SKIP_DIRS.has(entry.name)) {
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
      if (stat.isFile()) {
        const captured = captureSnapshotEntry(absolutePath, stat.size);
        snapshot.set(relativePath, {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          ...captured,
        });
      }
    }
  };
  if (fs.existsSync(root)) {
    visit(root, "");
  }
  return snapshot;
}

export function changedFilesBetween(before: Map<string, SnapshotEntry>, after: Map<string, SnapshotEntry>) {
  const changed = new Set<string>();
  for (const [relativePath, entry] of after) {
    const previous = before.get(relativePath);
    if (!previous || previous.size !== entry.size || previous.mtimeMs !== entry.mtimeMs) {
      changed.add(relativePath);
    }
  }
  for (const relativePath of before.keys()) {
    if (!after.has(relativePath)) {
      changed.add(relativePath);
    }
  }
  return [...changed].sort();
}

export function artifactSnapshotsForChangedFiles(
  before: Map<string, SnapshotEntry>,
  after: Map<string, SnapshotEntry>,
  changedFiles: string[],
) {
  return changedFiles.map((relativePath) => {
    const beforeEntry = before.get(relativePath) ?? null;
    const afterEntry = after.get(relativePath) ?? null;
    return {
      path: relativePath,
      beforeContent: beforeEntry?.textContent ?? null,
      afterContent: afterEntry?.textContent ?? null,
      beforeHash: beforeEntry?.hash ?? null,
      afterHash: afterEntry?.hash ?? null,
      sizeBytes: afterEntry?.size ?? beforeEntry?.size ?? null,
      encoding: afterEntry?.encoding ?? beforeEntry?.encoding ?? null,
      binary: Boolean(afterEntry?.binary ?? beforeEntry?.binary ?? false),
      truncated: Boolean(afterEntry?.truncated ?? beforeEntry?.truncated ?? false),
      unsupportedEncoding: Boolean(afterEntry?.unsupportedEncoding ?? beforeEntry?.unsupportedEncoding ?? false),
      metadata: afterEntry?.metadata ?? beforeEntry?.metadata ?? {},
    };
  });
}
