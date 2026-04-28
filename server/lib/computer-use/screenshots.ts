import fs from "node:fs";
import path from "node:path";

const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "session";
}

export function computerUseArtifactRoot(projectRoot: string) {
  return path.join(projectRoot, "workspace", "computer-use-artifacts");
}

export function writePrivateComputerUseScreenshot(params: {
  projectRoot: string;
  sessionId: string;
  buffer: Buffer;
}) {
  if (params.buffer.byteLength > MAX_SCREENSHOT_BYTES) {
    throw new Error("Computer Use screenshot exceeds the maximum artifact size.");
  }

  const root = computerUseArtifactRoot(params.projectRoot);
  const sessionDir = path.join(root, safeSegment(params.sessionId));
  fs.mkdirSync(sessionDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const finalPath = path.join(sessionDir, `${stamp}.png`);
  const tempPath = `${finalPath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;

  try {
    fs.writeFileSync(tempPath, params.buffer, { flag: "wx" });
    fs.renameSync(tempPath, finalPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }

  return path.relative(params.projectRoot, finalPath).replace(/\\/g, "/");
}

export function readPrivateComputerUseScreenshot(params: {
  projectRoot: string;
  relativePath: string | null;
}) {
  if (!params.relativePath) {
    return null;
  }
  const root = path.resolve(params.projectRoot);
  const resolved = path.resolve(root, params.relativePath);
  const artifactsRoot = path.resolve(computerUseArtifactRoot(params.projectRoot));
  if (!resolved.startsWith(`${artifactsRoot}${path.sep}`)) {
    throw new Error("Screenshot artifact path is outside the private Computer Use artifact directory.");
  }
  if (!fs.existsSync(resolved)) {
    return null;
  }
  const buffer = fs.readFileSync(resolved);
  if (buffer.byteLength > MAX_SCREENSHOT_BYTES) {
    throw new Error("Screenshot artifact exceeds the maximum readable size.");
  }
  return {
    mimeType: "image/png",
    base64: buffer.toString("base64"),
  };
}
