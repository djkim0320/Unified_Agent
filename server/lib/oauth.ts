import crypto from "node:crypto";

export function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64url");

  return {
    verifier,
    challenge,
  };
}

export function randomState() {
  return crypto.randomBytes(32).toString("base64url");
}
