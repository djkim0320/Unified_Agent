import type express from "express";

export function sendLegacyGone(response: express.Response, feature: string) {
  response.status(410).json({
    error: `${feature} is not available in AetherOps opencode-only mode. Configure equivalent capabilities in opencode.`,
    engineKind: "opencode",
  });
}
