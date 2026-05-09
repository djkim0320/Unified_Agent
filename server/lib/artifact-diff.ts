const DEFAULT_MAX_DIFF_BYTES = 128 * 1024;
const DEFAULT_MAX_DIFF_LINES = 4_000;
const DEFAULT_MAX_DIFF_MATRIX_CELLS = 2_000_000;
const CONTEXT_LINES = 3;

function maxDiffBytes() {
  const parsed = Number(process.env.AETHEROPS_MAX_ARTIFACT_DIFF_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_DIFF_BYTES;
}

function maxDiffLines() {
  const parsed = Number(process.env.AETHEROPS_MAX_DIFF_LINES);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_DIFF_LINES;
}

function maxDiffMatrixCells() {
  const parsed = Number(process.env.AETHEROPS_MAX_DIFF_MATRIX_CELLS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_DIFF_MATRIX_CELLS;
}

type DiffOp = { type: "context" | "add" | "remove"; line: string; oldLine: number | null; newLine: number | null };

function linesOf(value: string) {
  return value.length ? value.split(/\r?\n/) : [];
}

function lcsOperations(beforeLines: string[], afterLines: string[]): DiffOp[] {
  const rows = beforeLines.length + 1;
  const columns = afterLines.length + 1;
  const table = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        beforeLines[i] === afterLines[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < beforeLines.length && j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      ops.push({ type: "context", line: beforeLines[i], oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: "remove", line: beforeLines[i], oldLine: i + 1, newLine: null });
      i += 1;
    } else {
      ops.push({ type: "add", line: afterLines[j], oldLine: null, newLine: j + 1 });
      j += 1;
    }
  }
  while (i < beforeLines.length) {
    ops.push({ type: "remove", line: beforeLines[i], oldLine: i + 1, newLine: null });
    i += 1;
  }
  while (j < afterLines.length) {
    ops.push({ type: "add", line: afterLines[j], oldLine: null, newLine: j + 1 });
    j += 1;
  }
  return ops;
}

function buildHunks(ops: DiffOp[]) {
  const changedIndexes = ops
    .map((op, index) => (op.type === "context" ? -1 : index))
    .filter((index) => index >= 0);
  const hunks: DiffOp[][] = [];
  let currentStart = -1;
  let currentEnd = -1;
  for (const changedIndex of changedIndexes) {
    const start = Math.max(0, changedIndex - CONTEXT_LINES);
    const end = Math.min(ops.length - 1, changedIndex + CONTEXT_LINES);
    if (currentStart < 0) {
      currentStart = start;
      currentEnd = end;
    } else if (start <= currentEnd + 1) {
      currentEnd = Math.max(currentEnd, end);
    } else {
      hunks.push(ops.slice(currentStart, currentEnd + 1));
      currentStart = start;
      currentEnd = end;
    }
  }
  if (currentStart >= 0) {
    hunks.push(ops.slice(currentStart, currentEnd + 1));
  }
  return hunks;
}

function hunkHeader(hunk: DiffOp[]) {
  const oldLines = hunk.filter((op) => op.type !== "add");
  const newLines = hunk.filter((op) => op.type !== "remove");
  const oldStart = oldLines.find((op) => op.oldLine !== null)?.oldLine ?? 1;
  const newStart = newLines.find((op) => op.newLine !== null)?.newLine ?? 1;
  return `@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`;
}

function byteLength(value: string) {
  return Buffer.byteLength(value, "utf8");
}

export function createUnifiedDiff(pathLabel: string, before: string | null, after: string) {
  const beforeLines = before === null ? [] : linesOf(before);
  const afterLines = linesOf(after);
  const lineCountBefore = beforeLines.length;
  const lineCountAfter = afterLines.length;
  const maxLines = maxDiffLines();
  const maxMatrixCells = maxDiffMatrixCells();
  const matrixCells = Math.max(1, beforeLines.length + 1) * Math.max(1, afterLines.length + 1);
  if (before !== null && (lineCountBefore > maxLines || lineCountAfter > maxLines || matrixCells > maxMatrixCells)) {
    return {
      available: false as const,
      reason: "Diff exceeds configured complexity limit",
      truncated: true,
      lineCountBefore,
      lineCountAfter,
      maxLines,
      maxMatrixCells,
      matrixCells,
      sizeBytes: byteLength(before) + byteLength(after),
      maxBytes: maxDiffBytes(),
    };
  }
  const ops = before === null
    ? afterLines.map((line, index): DiffOp => ({ type: "add", line, oldLine: null, newLine: index + 1 }))
    : lcsOperations(beforeLines, afterLines);
  const hunks = before === null ? [ops] : buildHunks(ops);
  const lines = [before === null ? "--- /dev/null" : `--- a/${pathLabel}`, `+++ b/${pathLabel}`];
  for (const hunk of hunks) {
    lines.push(before === null ? "@@ -0,0 +1," + afterLines.length + " @@" : hunkHeader(hunk));
    for (const op of hunk) {
      lines.push(`${op.type === "add" ? "+" : op.type === "remove" ? "-" : " "}${op.line}`);
    }
  }
  const content = lines.join("\n");
  const maxBytes = maxDiffBytes();
  if (byteLength(content) > maxBytes) {
    return {
      available: false as const,
      reason: "Diff exceeds configured output limit",
      truncated: true,
      sizeBytes: byteLength(content),
      maxBytes,
      lineCountBefore,
      lineCountAfter,
      maxLines,
      maxMatrixCells,
      matrixCells,
    };
  }
  return {
    available: true as const,
    content,
    truncated: false,
    sizeBytes: byteLength(content),
    maxBytes,
    lineCountBefore,
    lineCountAfter,
    maxLines,
    maxMatrixCells,
    matrixCells,
  };
}
