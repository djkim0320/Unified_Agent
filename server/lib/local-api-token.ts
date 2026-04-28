import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const TOKEN_FILE_NAME = "local-api.token";

function bestEffortPrivateMode(filePath: string) {
  if (process.platform === "win32") {
    return;
  }

  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Permission hardening is best effort because chmod can fail on some mounted filesystems.
  }
}

function createToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function loadOrCreateLocalApiToken(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  const tokenPath = path.join(dataDir, TOKEN_FILE_NAME);

  if (fs.existsSync(tokenPath)) {
    const token = fs.readFileSync(tokenPath, "utf8").trim();
    bestEffortPrivateMode(tokenPath);
    if (!token) {
      throw new Error("Local API token file is empty.");
    }
    return token;
  }

  const token = createToken();
  fs.writeFileSync(tokenPath, `${token}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  bestEffortPrivateMode(tokenPath);
  return token;
}

export function isTokenMatch(candidate: string | undefined, expected: string) {
  if (!candidate) {
    return false;
  }

  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  if (candidateBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}
