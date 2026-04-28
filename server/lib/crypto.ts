import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const KEY_FILE = "secret.key";

function bestEffortPrivateMode(filePath: string) {
  if (process.platform === "win32") {
    return;
  }

  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Some mounted filesystems do not support chmod. Encryption still works; permissions are best effort.
  }
}

function ensureKeyFile(dataDir: string): Buffer {
  fs.mkdirSync(dataDir, { recursive: true });
  const keyPath = path.join(dataDir, KEY_FILE);
  if (!fs.existsSync(keyPath)) {
    // Do not delete this file unless you intentionally want to make encrypted provider
    // secrets unrecoverable. It is the local AES-GCM root key for provider credentials.
    fs.writeFileSync(keyPath, crypto.randomBytes(32), {
      mode: 0o600,
      flag: "wx",
    });
  }
  bestEffortPrivateMode(keyPath);
  const key = fs.readFileSync(keyPath);
  if (key.length !== 32) {
    throw new Error("Invalid encryption key length");
  }
  return key;
}

export function createSecretBox(dataDir: string) {
  const key = ensureKeyFile(dataDir);

  return {
    encrypt(value: unknown): string {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const payload = Buffer.from(JSON.stringify(value), "utf8");
      const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return [
        "v1",
        iv.toString("base64url"),
        authTag.toString("base64url"),
        encrypted.toString("base64url"),
      ].join(".");
    },

    decrypt<T>(payload: string): T {
      const [version, ivText, tagText, bodyText] = payload.split(".");
      if (version !== "v1" || !ivText || !tagText || !bodyText) {
        throw new Error("Invalid encrypted payload");
      }
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(ivText, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tagText, "base64url"));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(bodyText, "base64url")),
        decipher.final(),
      ]);
      return JSON.parse(decrypted.toString("utf8")) as T;
    },
  };
}

