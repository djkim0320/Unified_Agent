import { describe, expect, it } from "vitest";
import { createUnifiedDiff } from "./artifact-diff.js";

describe("artifact diff", () => {
  it("creates a readable new file diff", () => {
    const diff = createUnifiedDiff("notes/new.md", null, "one\ntwo\n");

    expect(diff.available).toBe(true);
    expect(diff.content).toContain("--- /dev/null");
    expect(diff.content).toContain("+++ b/notes/new.md");
    expect(diff.content).toContain("+one");
  });

  it("uses line-based hunks for insertions and deletions", () => {
    const diff = createUnifiedDiff(
      "notes/report.md",
      "alpha\nremove-me\ncharlie\n",
      "alpha\ninsert-me\ncharlie\n",
    );

    expect(diff.available).toBe(true);
    expect(diff.content).toContain("@@");
    expect(diff.content).toContain("-remove-me");
    expect(diff.content).toContain("+insert-me");
  });

  it("caps oversized diff output", () => {
    const previous = process.env.AETHEROPS_MAX_ARTIFACT_DIFF_BYTES;
    process.env.AETHEROPS_MAX_ARTIFACT_DIFF_BYTES = "100";
    const before = Array.from({ length: 500 }, (_, index) => `old-${index}`).join("\n");
    const after = Array.from({ length: 500 }, (_, index) => `new-${index}`).join("\n");
    const diff = createUnifiedDiff("huge.txt", before, after);
    if (previous === undefined) {
      delete process.env.AETHEROPS_MAX_ARTIFACT_DIFF_BYTES;
    } else {
      process.env.AETHEROPS_MAX_ARTIFACT_DIFF_BYTES = previous;
    }

    expect(diff.available).toBe(false);
    expect(diff.truncated).toBe(true);
    expect(diff.reason).toContain("exceeds");
  });

  it("rejects diffs that exceed LCS complexity limits before allocating the matrix", () => {
    const previousLines = process.env.AETHEROPS_MAX_DIFF_LINES;
    const previousCells = process.env.AETHEROPS_MAX_DIFF_MATRIX_CELLS;
    process.env.AETHEROPS_MAX_DIFF_LINES = "10000";
    process.env.AETHEROPS_MAX_DIFF_MATRIX_CELLS = "100";
    const before = Array.from({ length: 20 }, (_, index) => `old-${index}`).join("\n");
    const after = Array.from({ length: 20 }, (_, index) => `new-${index}`).join("\n");
    const diff = createUnifiedDiff("huge-matrix.txt", before, after);
    if (previousLines === undefined) {
      delete process.env.AETHEROPS_MAX_DIFF_LINES;
    } else {
      process.env.AETHEROPS_MAX_DIFF_LINES = previousLines;
    }
    if (previousCells === undefined) {
      delete process.env.AETHEROPS_MAX_DIFF_MATRIX_CELLS;
    } else {
      process.env.AETHEROPS_MAX_DIFF_MATRIX_CELLS = previousCells;
    }

    expect(diff.available).toBe(false);
    expect(diff.reason).toContain("complexity");
    expect(diff).toEqual(
      expect.objectContaining({
        lineCountBefore: 20,
        lineCountAfter: 20,
        maxMatrixCells: 100,
      }),
    );
  });
});
