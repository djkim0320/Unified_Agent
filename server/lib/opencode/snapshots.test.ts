import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const tempDirs: string[] = [];

function makeTempWorkspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aetherops-snapshot-test-"));
  tempDirs.push(directory);
  return directory;
}

async function loadSnapshots(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  return import("./snapshots.js");
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("opencode workspace snapshots", () => {
  it("keeps unchanged files metadata-only and avoids content capture", async () => {
    const snapshots = await loadSnapshots();
    const workspace = makeTempWorkspace();
    fs.writeFileSync(path.join(workspace, "unchanged.txt"), "same content\n", "utf8");

    const before = snapshots.snapshotWorkspace(workspace, { createBaseline: true });
    const after = snapshots.snapshotWorkspace(workspace);
    const changed = snapshots.changedFilesBetween(before, after);

    expect(changed).toEqual([]);
    expect(before.files.get("unchanged.txt")).toEqual(
      expect.objectContaining({
        hash: null,
        textContent: null,
      }),
    );
    snapshots.cleanupWorkspaceSnapshot(before);
  });

  it("captures before and after text only for changed small UTF-8 files", async () => {
    const snapshots = await loadSnapshots();
    const workspace = makeTempWorkspace();
    const target = path.join(workspace, "notes.md");
    fs.writeFileSync(target, "old\n", "utf8");

    const before = snapshots.snapshotWorkspace(workspace, { createBaseline: true });
    fs.writeFileSync(target, "new\n", "utf8");
    const after = snapshots.snapshotWorkspace(workspace);
    const changed = snapshots.changedFilesBetween(before, after);
    const [artifactSnapshot] = snapshots.artifactSnapshotsForChangedFiles(workspace, before, after, changed);

    expect(changed).toEqual(["notes.md"]);
    expect(artifactSnapshot).toEqual(
      expect.objectContaining({
        path: "notes.md",
        beforeContent: "old\n",
        afterContent: "new\n",
        binary: false,
        truncated: false,
      }),
    );
    expect(artifactSnapshot.beforeHash).toEqual(expect.any(String));
    expect(artifactSnapshot.afterHash).toEqual(expect.any(String));
    snapshots.cleanupWorkspaceSnapshot(before);
  });

  it("marks invalid UTF-8 changed files as unsupported instead of returning mojibake", async () => {
    const snapshots = await loadSnapshots();
    const workspace = makeTempWorkspace();

    const before = snapshots.snapshotWorkspace(workspace, { createBaseline: true });
    fs.writeFileSync(path.join(workspace, "bad.txt"), Buffer.from([0xff, 0xfe, 0xfd]));
    const after = snapshots.snapshotWorkspace(workspace);
    const changed = snapshots.changedFilesBetween(before, after);
    const [artifactSnapshot] = snapshots.artifactSnapshotsForChangedFiles(workspace, before, after, changed);

    expect(artifactSnapshot).toEqual(
      expect.objectContaining({
        afterContent: null,
        binary: false,
        unsupportedEncoding: true,
      }),
    );
    snapshots.cleanupWorkspaceSnapshot(before);
  });

  it("marks snapshots as degraded when file count caps are exceeded", async () => {
    const snapshots = await loadSnapshots({ AETHEROPS_MAX_SNAPSHOT_FILES: "1" });
    const workspace = makeTempWorkspace();
    fs.writeFileSync(path.join(workspace, "one.txt"), "1", "utf8");
    fs.writeFileSync(path.join(workspace, "two.txt"), "2", "utf8");

    const snapshot = snapshots.snapshotWorkspace(workspace);

    expect(snapshot.degraded).toBe(true);
    expect(snapshot.degradationReasons.join("\n")).toContain("file count exceeded 1");
    expect(snapshot.files.size).toBe(1);
  });
});
